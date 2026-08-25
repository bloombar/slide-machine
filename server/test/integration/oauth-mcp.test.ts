/**
 * The remote OAuth flow, end to end (docs/MCP.md §5).
 *
 * This is the highest-stakes code in the application: a mishandled redirect or
 * a check in the wrong order hands one instructor's lectures to a stranger.
 * So the tests here are not only "the happy path works" — most of them are
 * attempts to get a token without being entitled to one, and each names the
 * attack it stands for.
 *
 * The flow being exercised is the real one an assistant performs: discover the
 * server, register itself, send the user to consent, exchange the code with
 * PKCE, then call a tool.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { OAuthClientModel } from '../../src/models/oauth-client'
import { OAuthTokenModel } from '../../src/models/oauth-token'
import { OAuthAuthorizationModel } from '../../src/models/oauth-authorization'
import { SCOPES } from '../../src/oauth/scopes'
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  CONSENT_REQUEST_TTL_SECONDS,
} from '../../src/oauth/store'

const server = createApp().listen(0)
afterAll(() => server.close())

/** A PKCE pair, as a real client generates one. */
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: 'Instructor' })
  expect(res.status).toBe(201)
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

/** Registers an assistant the way a real one introduces itself (RFC 7591). */
const registerClient = async (redirectUri = 'https://assistant.test/cb') => {
  const res = await request(server)
    .post('/oauth/register')
    .send({
      client_name: 'Test Assistant',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
  expect(res.status).toBe(201)
  return res.body as { client_id: string }
}

/**
 * Walks the whole flow and returns the tokens, so the tests below can each
 * attack one step rather than restating the other five.
 */
const connect = async (
  sessionToken: string,
  scopes: string[] = [SCOPES.read, SCOPES.write],
) => {
  const client = await registerClient()
  const { verifier, challenge } = pkce()

  const authorize = await request(server)
    .get('/oauth/authorize')
    .query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://assistant.test/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: scopes.join(' '),
      state: 'client-state-123',
    })
  expect(authorize.status).toBe(302)

  const requestId = new URL(
    authorize.headers.location!,
    'http://localhost',
  ).searchParams.get('request')!

  const approve = await request(server)
    .post(`/api/oauth/authorization/${requestId}/approve`)
    .set('Authorization', `Bearer ${sessionToken}`)
    .send({})
  expect(approve.status).toBe(200)

  const code = new URL(approve.body.redirectTo).searchParams.get('code')!

  const token = await request(server).post('/oauth/token').type('form').send({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: client.client_id,
    redirect_uri: 'https://assistant.test/cb',
  })
  expect(token.status).toBe(200)

  return {
    client,
    requestId,
    verifier,
    code,
    tokens: token.body as {
      access_token: string
      refresh_token: string
      scope: string
    },
  }
}

/** One MCP JSON-RPC call with an OAuth token. */
const mcp = (accessToken: string | null, body: unknown) => {
  const req = request(server)
    .post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
  if (accessToken) req.set('Authorization', `Bearer ${accessToken}`)
  return req.send(body as object)
}

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    ProjectModel.init(),
    OAuthTokenModel.init(),
  ])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    OAuthClientModel.deleteMany({}),
    OAuthTokenModel.deleteMany({}),
    OAuthAuthorizationModel.deleteMany({}),
  ])
})

describe('discovery', () => {
  it('tells an unauthenticated caller where to go and ask', async () => {
    // Without this an assistant that has never seen the server has no way to
    // begin — it is the whole of "remote" in the requirement.
    const res = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'initialize' })

    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('publishes protected resource metadata naming its authorization server', async () => {
    const res = await request(server).get(
      '/.well-known/oauth-protected-resource/api/mcp',
    )
    expect(res.status).toBe(200)
    expect(res.body.authorization_servers?.length).toBeGreaterThan(0)
  })

  it('publishes authorization server metadata with the endpoints and scopes', async () => {
    const res = await request(server).get(
      '/.well-known/oauth-authorization-server',
    )

    expect(res.status).toBe(200)
    expect(res.body.authorization_endpoint).toContain('/oauth/authorize')
    expect(res.body.token_endpoint).toContain('/oauth/token')
    expect(res.body.registration_endpoint).toContain('/oauth/register')
    // OAuth 2.1 has no flow without PKCE, so the server must say it requires it.
    expect(res.body.code_challenge_methods_supported).toContain('S256')
    expect(res.body.scopes_supported).toEqual([SCOPES.read, SCOPES.write])
  })
})

describe('living alongside the application', () => {
  it('leaves the app’s own /register page alone', async () => {
    // The SDK puts dynamic client registration at /register, and this app has
    // a sign-up PAGE there. The registration endpoint answers anything that is
    // not a POST with 405, so mounting the two together turned the sign-up
    // screen into a method error — and in production, where Express serves the
    // SPA, took the page out entirely. 249 e2e failures, all from this.
    const res = await request(server).get('/register')
    expect(res.status).not.toBe(405)
  })

  it('does not answer client registration at the root either', async () => {
    // A POST there is the app's business, not the OAuth server's.
    const res = await request(server)
      .post('/register')
      .send({
        client_name: 'Test Assistant',
        redirect_uris: ['https://assistant.test/cb'],
      })
    expect(res.status).not.toBe(201)
  })

  it('advertises every endpoint under the prefix it actually serves', async () => {
    // The paths are not guessable and are never meant to be: a client reads
    // them from here (RFC 8414). What must hold is that what is advertised is
    // what answers.
    const meta = await request(server).get(
      '/.well-known/oauth-authorization-server',
    )
    for (const key of [
      'authorization_endpoint',
      'token_endpoint',
      'registration_endpoint',
      'revocation_endpoint',
    ]) {
      expect(meta.body[key], key).toContain('/oauth/')
    }
  })
})

describe('how long each half of the flow lasts', () => {
  it('gives a person longer to decide than a machine gets to redirect', async () => {
    // Two different measurements. Five minutes is a browser redirect; the
    // consent window is a human being asked to weigh what an assistant may
    // do, possibly after signing in first. Sharing one clock meant a careful
    // reader ran out of time.
    expect(CONSENT_REQUEST_TTL_SECONDS).toBeGreaterThan(
      AUTHORIZATION_CODE_TTL_SECONDS,
    )
  })

  it('gives the code a full window from the moment of approval', async () => {
    // The bug this pins: with one shared clock, taking four minutes to read
    // the screen left the code one minute to be exchanged.
    const session = await registerUser('windows@example.test')
    const client = await registerClient()
    const { challenge } = pkce()

    const authorize = await request(server).get('/oauth/authorize').query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://assistant.test/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const requestId = new URL(
      authorize.headers.location!,
      'http://localhost',
    ).searchParams.get('request')!

    // Stand where a slow reader stands: the request is nearly out of time.
    const nearlyGone = new Date(Date.now() + 2000)
    await OAuthAuthorizationModel.updateOne(
      { _id: requestId },
      { $set: { expiresAt: nearlyGone } },
    )

    await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .send({})

    const after = await OAuthAuthorizationModel.findById(requestId)
    expect(after!.expiresAt.getTime()).toBeGreaterThan(
      nearlyGone.getTime() + 60_000,
    )
  })
})

describe('the full connect flow', () => {
  it('lets an assistant nobody arranged register, get consent, and call a tool', async () => {
    const session = await registerUser('flow@example.test')
    const { tokens } = await connect(session)

    const res = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'find_lectures', arguments: {} },
    })

    expect(res.status).toBe(200)
    expect(res.body.result.isError).toBeUndefined()
    expect(res.body.result.content[0].text).toBeTruthy()
  })

  it('acts as the user who approved it, not as anyone else', async () => {
    const owner = await registerUser('owner@example.test')
    await registerUser('bystander@example.test')

    // The owner makes a lecture through the ordinary app path.
    const project = await request(server)
      .post('/api/actions/project.create')
      .set('Authorization', `Bearer ${owner}`)
      .send({ title: 'CS 101' })
    const projectId = project.body.id as string
    await request(server)
      .post('/api/actions/deck.create')
      .set('Authorization', `Bearer ${owner}`)
      .send({ projectId, title: 'Week 4' })

    const { tokens } = await connect(owner)
    const res = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'find_lectures', arguments: {} },
    })

    expect(res.body.result.content[0].text).toContain('Week 4')
  })

  it('exchanges a refresh token, and burns the one it was given', async () => {
    const session = await registerUser('refresh@example.test')
    const { client, tokens } = await connect(session)

    const first = await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })
    expect(first.status).toBe(200)
    expect(first.body.access_token).not.toBe(tokens.access_token)

    // Rotation: a stolen refresh token is worth one exchange, not a standing key.
    const replay = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(replay.status).toBe(400)
  })
})

describe('attempts to get in without consent', () => {
  it('refuses a made-up access token', async () => {
    const res = await mcp('not-a-real-token', {
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
    })
    expect(res.status).toBe(401)
  })

  it('refuses to send a code anywhere the client did not register', async () => {
    // An unchecked redirect URI is the classic way this kind of server hands
    // an account to a stranger: the user consents, the code goes to the
    // attacker.
    const client = await registerClient()
    const { challenge } = pkce()

    const res = await request(server).get('/oauth/authorize').query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://attacker.test/steal',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('redirect_uri')
  })

  it('refuses a code presented with the wrong PKCE verifier', async () => {
    // What stops an attacker who intercepted the code — they did not generate
    // the verifier, so the code alone is worthless.
    const session = await registerUser('pkce@example.test')
    const client = await registerClient()
    const { challenge } = pkce()

    const authorize = await request(server).get('/oauth/authorize').query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://assistant.test/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const requestId = new URL(
      authorize.headers.location!,
      'http://localhost',
    ).searchParams.get('request')!

    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .send({})
    const code = new URL(approve.body.redirectTo).searchParams.get('code')!

    const res = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: randomBytes(32).toString('base64url'),
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })
    expect(res.status).toBe(400)
  })

  it('refuses to mint a code for someone who is not signed in', async () => {
    const client = await registerClient()
    const { challenge } = pkce()
    const authorize = await request(server).get('/oauth/authorize').query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://assistant.test/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const requestId = new URL(
      authorize.headers.location!,
      'http://localhost',
    ).searchParams.get('request')!

    const res = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .send({})
    expect(res.status).toBe(401)
  })

  it('spends an authorization code exactly once', async () => {
    const session = await registerUser('replay@example.test')
    const { client, code, verifier } = await connect(session)

    // The first exchange happened inside connect(); a replay must not work.
    const res = await request(server).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: 'https://assistant.test/cb',
    })
    expect(res.status).toBe(400)
  })

  it('does not let one assistant redeem another’s refresh token', async () => {
    const session = await registerUser('crossclient@example.test')
    const { tokens } = await connect(session)
    const other = await registerClient('https://other.test/cb')

    const res = await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: other.client_id,
    })
    expect(res.status).toBe(400)
  })

  it('refuses a consent request that was already answered', async () => {
    const session = await registerUser('twice@example.test')
    const { requestId } = await connect(session)

    const res = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .send({})
    expect(res.status).toBe(404)
  })
})

describe('what consent actually decided', () => {
  it('shows the consent screen who is asking and for what', async () => {
    const session = await registerUser('screen@example.test')
    const client = await registerClient()
    const { challenge } = pkce()

    const authorize = await request(server).get('/oauth/authorize').query({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: 'https://assistant.test/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: SCOPES.read,
    })
    const requestId = new URL(
      authorize.headers.location!,
      'http://localhost',
    ).searchParams.get('request')!

    const res = await request(server)
      .get(`/api/oauth/authorization/${requestId}`)
      .set('Authorization', `Bearer ${session}`)

    expect(res.status).toBe(200)
    expect(res.body.clientName).toBe('Test Assistant')
    expect(res.body.scopes).toEqual([
      { scope: SCOPES.read, description: expect.stringContaining('See your') },
    ])
  })

  it('holds a read-only connection to reading, however capable the account', async () => {
    const session = await registerUser('readonly@example.test')
    const { tokens } = await connect(session, [SCOPES.read])

    const res = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'rename_lecture',
        arguments: { lectureId: 'x', title: 'y' },
      },
    })

    // The tool is not even advertised to this connection, so the SDK refuses
    // it before the scope check inside the server is reached. Either way the
    // answer is no.
    expect(JSON.stringify(res.body)).toMatch(/not found|insufficient_scope/)
  })

  it('advertises only the tools a read-only connection can use', async () => {
    const session = await registerUser('advertise@example.test')
    const { tokens } = await connect(session, [SCOPES.read])

    const res = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/list',
      params: {},
    })

    const names = res.body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('find_lectures')
    expect(names).not.toContain('edit_slides')
  })

  it('carries the user’s answer, not the request, into the token', async () => {
    const session = await registerUser('granted@example.test')
    const { tokens } = await connect(session, [SCOPES.read])
    expect(tokens.scope).toBe(SCOPES.read)
  })

  it('lets the user take it back', async () => {
    const session = await registerUser('revoke@example.test')
    const { client, tokens } = await connect(session)

    const revoked = await request(server)
      .post('/oauth/revoke')
      .type('form')
      .send({
        token: tokens.access_token,
        client_id: client.client_id,
      })
    expect(revoked.status).toBe(200)

    const res = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 7,
      method: 'initialize',
    })
    expect(res.status).toBe(401)
  })
})
