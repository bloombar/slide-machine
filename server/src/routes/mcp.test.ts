/**
 * Tests for the MCP endpoint (docs/MCP.md).
 *
 * These drive the real Express app over HTTP with the token verifier and the
 * action dispatcher stubbed, so what is exercised is the route's own job — the
 * scope a token carries, the rate limit, and the JSON-RPC handshake through
 * the SDK's transport — without a database standing behind it.
 *
 * The OAuth flow that produces such a token is tested for real, against a
 * database, in test/integration/oauth-mcp.test.ts. Ownership and metering are
 * the action layer's to enforce and are tested where they live. The point
 * here is that an agent request reaches the tools at all, and only when it
 * should.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'

// Stands in for a token the OAuth flow would have issued. `good-token`
// carries both scopes; `read-token` carries only reading, which is how the
// consent screen's answer reaches this route.
vi.mock('../oauth/provider', async importOriginal => {
  const actual = await importOriginal<typeof import('../oauth/provider')>()
  const { InvalidTokenError } =
    await import('@modelcontextprotocol/sdk/server/auth/errors.js')
  return {
    ...actual,
    provider: {
      ...actual.provider,
      verifyAccessToken: vi.fn(async (token: string) => {
        if (token !== 'good-token' && token !== 'read-token') {
          throw new InvalidTokenError('nope')
        }
        return {
          token,
          clientId: 'client-a',
          // Required: the SDK refuses a bearer token with no expiry, which
          // is the right rule — a token that never dies cannot be outlived.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          scopes:
            token === 'read-token'
              ? ['lectures.read']
              : ['lectures.read', 'lectures.write'],
          extra: { userId: 'user-1' },
        }
      }),
    },
  }
})

vi.mock('../actions/dispatch', async importOriginal => {
  const actual = await importOriginal<typeof import('../actions/dispatch')>()
  return { ...actual, dispatch: vi.fn(async () => []) }
})

const { createApp } = await import('../app')
const { mcpRateLimiter } = await import('./mcp')
const { dispatch } = await import('../actions/dispatch')

const server = createApp().listen(0)
afterAll(() => server.close())

/** The headers a Streamable HTTP client sends on every call. */
const rpc = (token: string | null, body: unknown) => {
  const req = request(server)
    .post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
  if (token) req.set('Authorization', `Bearer ${token}`)
  return req.send(body as object)
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}

beforeEach(() => {
  mcpRateLimiter.reset()
  vi.mocked(dispatch).mockClear()
})

describe('POST /api/mcp', () => {
  it('refuses a request with no token, and says where to get one', async () => {
    // The header is how an assistant that has never seen this server finds
    // the authorization server at all (RFC 9728).
    const res = await rpc(null, INITIALIZE)

    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('refuses a token it cannot verify', async () => {
    const res = await rpc('nonsense', INITIALIZE)
    expect(res.status).toBe(401)
  })

  it('completes the handshake and names the server', async () => {
    const res = await rpc('good-token', INITIALIZE)

    expect(res.status).toBe(200)
    expect(res.body.result.serverInfo.name).toBe('slide-machine')
    expect(res.body.result.capabilities.tools).toBeDefined()
    // The instructions tell the model where ids come from; without them an
    // agent guesses at deck ids and gets refused.
    expect(res.body.result.instructions).toContain('find_lectures')
  })

  it('advertises the tool surface with its schemas', async () => {
    const res = await rpc('good-token', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })

    expect(res.status).toBe(200)
    const names = res.body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('find_lectures')
    expect(names).toContain('edit_slides')
    // Nothing destructive is advertised, whatever the account may do in the app.
    expect(names).not.toContain('delete_lecture')

    const find = res.body.result.tools.find(
      (t: { name: string }) => t.name === 'find_lectures',
    )
    expect(find.inputSchema.type).toBe('object')
    expect(find.annotations.readOnlyHint).toBe(true)
  })

  it('runs a tool as the authenticated account', async () => {
    const res = await rpc('good-token', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'find_lectures', arguments: {} },
    })

    expect(res.status).toBe(200)
    expect(res.body.result.isError).toBeUndefined()
    // Every action the tool dispatched carried the token's account — this is
    // the whole of the "same auth as the app" claim, at the seam where it is
    // made.
    for (const call of vi.mocked(dispatch).mock.calls) {
      expect(call[2]).toMatchObject({ userId: 'user-1' })
    }
  })

  it('offers a read-only connection only the tools it may use', async () => {
    const res = await rpc('read-token', {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/list',
      params: {},
    })

    const names = res.body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('find_lectures')
    expect(names).not.toContain('edit_slides')
  })

  it('hands a refused call back as a readable error result', async () => {
    const { ActionForbiddenError } = await import('../actions/dispatch')
    vi.mocked(dispatch).mockRejectedValueOnce(new ActionForbiddenError())

    const res = await rpc('good-token', {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'read_lecture', arguments: { lectureId: 'nope' } },
    })

    // A tool error, not a protocol error: the model is told what happened and
    // can act on it, rather than having the call torn down under it.
    expect(res.status).toBe(200)
    expect(res.body.result.isError).toBe(true)
    expect(res.body.result.content[0].text).toContain('code: forbidden')
  })

  it('rejects a tool call whose arguments do not fit the schema', async () => {
    const res = await rpc('good-token', {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'read_lecture', arguments: {} },
    })

    expect(res.status).toBe(200)
    expect(res.body.result?.isError ?? res.body.error).toBeTruthy()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('slows down an agent that loops, per account', async () => {
    // Plan caps bound spend, not volume, and the read tools are free — so
    // nothing in the billing layer would ever stop this.
    for (let i = 0; i < 240; i += 1) mcpRateLimiter.take('user-1')

    const res = await rpc('good-token', INITIALIZE)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
  })

  it('does not let one account’s loop lock another out', async () => {
    for (let i = 0; i < 240; i += 1) mcpRateLimiter.take('someone-else')

    const res = await rpc('good-token', INITIALIZE)
    expect(res.status).toBe(200)
  })
})
