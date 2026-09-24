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
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
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
import { provider } from '../../src/oauth/provider'
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  CONSENT_REQUEST_TTL_SECONDS,
  hashToken,
} from '../../src/oauth/store'
import * as mailer from '../../src/lib/mailer'

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
 * Registers a client through the store directly, bypassing the HTTP
 * endpoint's own rate limiter (the SDK's `clientRegistrationHandler` allows
 * 20 registrations per hour per IP by default, and this file's existing
 * tests already use most of that budget exercising the real endpoint —
 * legitimately, since some of them are about registration itself). What the
 * tests below this point exercise is authorize/approve/exchange, not
 * registration, so calling `provider.clientsStore` in-process is faithful to
 * what is under test while not spending shared budget the rest of the file
 * needs.
 */
const registerClientDirect = async (
  redirectUri = 'https://assistant.test/cb',
) => {
  const full = await provider.clientsStore.registerClient!({
    client_name: 'Test Assistant',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
  return { client_id: full.client_id }
}

/** The full raw `Set-Cookie` header for the binding cookie named after
 * `requestId` (rework round 1's root cause C4 — the cookie is no longer one
 * fixed name, so finding it needs the id). */
const rawConsentCookie = (
  res: { headers: Record<string, unknown> },
  requestId: string,
): string => {
  const raw = res.headers['set-cookie'] as string[] | undefined
  const prefix = `__Host-sm_oauth_consent_${requestId}=`
  const found = raw?.find(c => c.startsWith(prefix))
  if (!found) throw new Error('authorize did not set the binding cookie')
  return found
}

/** The `Set-Cookie` header's value with attributes stripped, for handing
 * straight to `.set('Cookie', ...)` on the next request from "the same
 * browser". `supertest` does not carry cookies between calls on its own
 * (that is `superagent`'s `.agent()`, which these tests deliberately do not
 * use — several of them need to send the *wrong* browser on purpose). */
const cookieHeader = (
  res: { headers: Record<string, unknown> },
  requestId: string,
): string => rawConsentCookie(res, requestId).split(';')[0]!

/**
 * Starts a flow and returns the parked request id, the binding cookie the
 * browser that started it was given, and the raw `Set-Cookie` header (for
 * asserting its security attributes — see "the binding cookie's own
 * attributes" below) — everything every consent-endpoint call needs
 * (finding 1a, docs/plans/OAUTH_CONSENT_SECURITY.md).
 */
const beginAuthorize = async (
  clientId: string,
  challenge: string,
  scopes: string[] = [SCOPES.read, SCOPES.write],
  redirectUri = 'https://assistant.test/cb',
) => {
  const authorize = await request(server)
    .get('/oauth/authorize')
    .query({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
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
  return {
    requestId,
    cookie: cookieHeader(authorize, requestId),
    rawCookie: rawConsentCookie(authorize, requestId),
  }
}

/**
 * Walks the whole flow and returns the tokens, so the tests below can each
 * attack one step rather than restating the other five. Carries the binding
 * cookie from the authorize step into approve, exactly as a real browser
 * would — this is "the same browser" case; tests for finding 1a construct
 * the mismatched-cookie case by hand instead of through this helper.
 */
const connect = async (
  sessionToken: string,
  scopes: string[] = [SCOPES.read, SCOPES.write],
  // Pre-registered client for tests that need several connections and would
  // otherwise spend the registration endpoint's rate-limit budget on
  // repeats of the same registration; see `registerClientDirect`.
  presetClient?: { client_id: string },
) => {
  const client = presetClient ?? (await registerClient())
  const { verifier, challenge } = pkce()

  const { requestId, cookie } = await beginAuthorize(
    client.client_id,
    challenge,
    scopes,
  )

  const approve = await request(server)
    .post(`/api/oauth/authorization/${requestId}/approve`)
    .set('Authorization', `Bearer ${sessionToken}`)
    .set('Cookie', cookie)
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
    cookie,
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
  // A revocation's notify/log side effects are deliberately fire-and-forget
  // (root cause F2, rework round 1) and so are still in flight past the
  // point the test that triggered them already returned. Left undrained,
  // one of those straggling calls (a `UserModel.findById`, most often) can
  // land after this wipe and before the next test's own fixtures exist,
  // producing a flake whose failure moves around depending on which test
  // happened to trigger a revocation most recently. A short pause first is
  // cheaper than instrumenting every call site that can revoke.
  await new Promise(resolve => setTimeout(resolve, 20))
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

    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
    )

    // Stand where a slow reader stands: the request is nearly out of time.
    const nearlyGone = new Date(Date.now() + 2000)
    await OAuthAuthorizationModel.updateOne(
      { _id: requestId },
      { $set: { expiresAt: nearlyGone } },
    )

    await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
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

  it('creates a project, then files a lecture into the id it returned', async () => {
    // The two new tools working together over the real protocol: unit tests
    // drive them against a fake caller, which cannot show that project.create
    // is reachable through OAuth and that the id it prints is one
    // create_lecture actually accepts.
    const session = await registerUser('newcourse@example.test')
    const { tokens } = await connect(session)

    const made = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_project',
        arguments: { title: 'Algorithms, Autumn 2026', course: 'CS-201' },
      },
    })
    expect(made.body.result.isError).toBeUndefined()
    const projectId = made.body.result.structuredContent.id as string
    expect(projectId).toBeTruthy()

    const filed = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'create_lecture',
        arguments: { projectId, title: 'Week 1 — Sorting' },
      },
    })
    expect(filed.body.result.isError).toBeUndefined()
    expect(filed.body.result.structuredContent.projectId).toBe(projectId)

    // And the project is discoverable by the tool that exists to offer it.
    const found = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'find_projects', arguments: {} },
    })
    expect(found.body.result.content[0].text).toContain(projectId)
    expect(found.body.result.content[0].text).toContain('CS-201')
  })

  it('creates the project for the approving account alone', async () => {
    const owner = await registerUser('mine@example.test')
    const bystander = await registerUser('theirs@example.test')
    const { tokens } = await connect(owner)

    const made = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'create_project',
        arguments: { title: 'Private Course' },
      },
    })
    expect(made.body.result.isError).toBeUndefined()

    // Assert the project exists for the owner BEFORE asserting it is absent
    // for the bystander. The absence on its own is not evidence: it reads
    // exactly the same when create_project never ran at all.
    const mine = await request(server)
      .post('/api/actions/project.list')
      .set('Authorization', `Bearer ${owner}`)
      .send({})
    expect((mine.body as { title: string }[]).map(p => p.title)).toContain(
      'Private Course',
    )

    // The bystander's own listing must not have gained a project.
    const theirs = await request(server)
      .post('/api/actions/project.list')
      .set('Authorization', `Bearer ${bystander}`)
      .send({})
    expect(
      (theirs.body as { title: string }[]).map(p => p.title),
    ).not.toContain('Private Course')
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

    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
    )

    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
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
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
    )

    // No Authorization header at all — requireAuth refuses this before the
    // binding cookie is even considered, and it is the binding cookie that
    // is being forwarded correctly here, so this stays a clean test of
    // requireAuth alone.
    const res = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Cookie', cookie)
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
    // The cookie is forwarded here deliberately (E2, rework round 1): without
    // it the 404 below would come from the missing-cookie branch, not from
    // `codeHash` already being set, and this test would stop testing what its
    // name says. Reusing the value the server already asked the browser to
    // clear is fine for this assertion — supertest does not track cookie
    // jars, so nothing here relies on the browser having "forgotten" it.
    const session = await registerUser('twice@example.test')
    const { requestId, cookie } = await connect(session)

    const res = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
      .send({})
    expect(res.status).toBe(404)
  })
})

describe('what consent actually decided', () => {
  it('shows the consent screen who is asking, for what, to which account, and where', async () => {
    const session = await registerUser('screen@example.test')
    const client = await registerClient()
    const { challenge } = pkce()

    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
      [SCOPES.read],
    )

    const res = await request(server)
      .get(`/api/oauth/authorization/${requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)

    expect(res.status).toBe(200)
    expect(res.body.clientName).toBe('Test Assistant')
    expect(res.body.scopes).toEqual([
      { scope: SCOPES.read, description: expect.stringContaining('See your') },
    ])
    // finding 1b: the two facts a server-side check alone cannot supply —
    // which account is about to be connected, and where the code will be
    // sent. Both come straight from the parked row and the session, never
    // from anything the assistant supplied at exchange time.
    expect(res.body.account).toBe('screen@example.test')
    expect(res.body.redirectTarget).toBe('https://assistant.test')
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

/**
 * The link a tool hands back (docs/MCP.md §4).
 *
 * The unit tests check that a URL is built from a slug. What they cannot show
 * is that the slug is one the app will actually serve — the tools compose
 * actions, the viewer is served by a different route, and a link that formats
 * perfectly and resolves to nothing is exactly as useless as no link at all.
 * So this follows the address home.
 */
describe('the link an assistant hands back', () => {
  it('points at a lecture the app really serves, on the slide that changed', async () => {
    const session = await registerUser('linked@example.test')
    const project = await request(server)
      .post('/api/actions/project.create')
      .set('Authorization', `Bearer ${session}`)
      .send({ title: 'CS 101' })
    const { tokens } = await connect(session)

    const made = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'create_lecture',
        arguments: { projectId: project.body.id, title: 'Week 4 — Recursion' },
      },
    })
    const lectureId = made.body.result.structuredContent.id as string

    const added = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'add_slide',
        arguments: { lectureId, title: 'Base case' },
      },
    })
    expect(added.body.result.isError).toBeUndefined()

    const slideId = added.body.result.structuredContent.id as string
    const link = added.body.result.structuredContent.url as string
    // The model reads prose, so the address must be in the text too — not
    // only in structured output a client may never show it.
    expect(added.body.result.content[0].text).toContain(link)

    const url = new URL(link)
    expect(url.searchParams.get('slide')).toBe(slideId)

    // Follow it: the viewer's own route, addressed by the slug in the link,
    // with the session an instructor clicking it would have.
    const slug = url.pathname.replace('/d/', '')
    const viewed = await request(server)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${session}`)
    expect(viewed.status).toBe(200)
    expect(viewed.body.deck.id).toBe(lectureId)
    expect(viewed.body.slides.map((s: { id: string }) => s.id)).toContain(
      slideId,
    )
  })

  it('is refused to someone else, so the link is not the credential', async () => {
    // Nothing about the address grants access: it is the ordinary sign-in
    // that decides, which is why no signing or expiry is needed on it.
    const owner = await registerUser('linkowner@example.test')
    const stranger = await registerUser('linkstranger@example.test')
    const project = await request(server)
      .post('/api/actions/project.create')
      .set('Authorization', `Bearer ${owner}`)
      .send({ title: 'CS 101' })
    // Projects made by a confirmed account are public by default, and a
    // lecture inherits that — so the private case has to be asked for.
    await request(server)
      .post('/api/actions/project.setAccess')
      .set('Authorization', `Bearer ${owner}`)
      .send({ projectId: project.body.id, visibility: 'restricted' })
    const { tokens } = await connect(owner)

    const made = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'create_lecture',
        arguments: { projectId: project.body.id, title: 'Private' },
      },
    })
    const link = made.body.result.structuredContent.url as string
    const slug = new URL(link).pathname.replace('/d/', '')

    const asStranger = await request(server)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${stranger}`)
    expect(asStranger.status).toBe(404)
  })
})

/**
 * Finding 1 (docs/plans/OAUTH_CONSENT_SECURITY.md): a parked request could be
 * approved by whoever the link was forwarded to, not only by the browser
 * that started the flow. Both variants the doc names are covered here on
 * purpose — a suite that only tried "the attacker sends the consent link"
 * is exactly what let the authorize-URL variant go unnoticed at wikistreets.
 */
describe('binding the parked request to the browser that started it', () => {
  it('refuses approval when the attacker parks the request and hands the victim only the consent link', async () => {
    const victim = await registerUser('victim-consent-link@example.test')
    const client = await registerClientDirect()
    const { challenge } = pkce()

    // The attacker's own browser is the one that reached /oauth/authorize
    // and holds the resulting cookie; the victim never had it.
    const { requestId } = await beginAuthorize(client.client_id, challenge)

    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${victim}`)
      .send({})
    expect(approve.status).toBe(404)
  })

  it('cannot refuse the harder variant — the victim’s own browser starting the flow — which is what finding 1b exists for', async () => {
    const victim = await registerUser('victim-own-browser@example.test')
    // The attacker registers a client with a redirect URI they control.
    const client = await registerClientDirect('https://attacker.test/cb')
    const { challenge } = pkce()

    // The victim clicks a link straight to /oauth/authorize (not the
    // consent screen) — their own browser makes this request and
    // legitimately ends up holding the binding cookie. The binding check
    // alone cannot tell this apart from a genuine flow, because it is one.
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
      [SCOPES.read, SCOPES.write],
      'https://attacker.test/cb',
    )

    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${victim}`)
      .set('Cookie', cookie)
      .send({})
    expect(approve.status).toBe(200)
    expect(new URL(approve.body.redirectTo).host).toBe('attacker.test')
  })

  it('answers missing, expired, already-answered, wrong-browser and malformed ids identically', async () => {
    const session = await registerUser('uniform-refusal@example.test')
    const client = await registerClientDirect()

    const missing = await request(server)
      .get(`/api/oauth/authorization/${new Types.ObjectId().toString()}`)
      .set('Authorization', `Bearer ${session}`)

    const { requestId: expiredId, cookie: expiredCookie } =
      await beginAuthorize(client.client_id, pkce().challenge)
    await OAuthAuthorizationModel.updateOne(
      { _id: expiredId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    )
    const expired = await request(server)
      .get(`/api/oauth/authorization/${expiredId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', expiredCookie)

    const { requestId: answeredId, cookie: answeredCookie } =
      await beginAuthorize(client.client_id, pkce().challenge)
    await request(server)
      .post(`/api/oauth/authorization/${answeredId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', answeredCookie)
      .send({})
    const answered = await request(server)
      .get(`/api/oauth/authorization/${answeredId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', answeredCookie)

    const { requestId: wrongBrowserId } = await beginAuthorize(
      client.client_id,
      pkce().challenge,
    )
    const wrongBrowser = await request(server)
      .get(`/api/oauth/authorization/${wrongBrowserId}`)
      .set('Authorization', `Bearer ${session}`)
    // deliberately no Cookie header at all

    const malformed = await request(server)
      .get('/api/oauth/authorization/not-an-object-id')
      .set('Authorization', `Bearer ${session}`)

    for (const res of [expired, answered, wrongBrowser, malformed]) {
      expect(res.status).toBe(missing.status)
      expect(res.body).toEqual(missing.body)
    }
  })
})

/**
 * Finding 2: a replayed authorization code was refused and nothing else
 * happened, discarding the one useful signal it carries — the code leaked.
 */
describe('a replayed authorization code', () => {
  it('revokes the tokens it minted, and refuses byte-identically to an unknown code', async () => {
    const session = await registerUser('replay-revokes@example.test')
    const preset = await registerClientDirect()
    const { client, code, verifier, tokens } = await connect(
      session,
      undefined,
      preset,
    )

    // The tokens from the honest exchange work before the replay.
    const before = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 90,
      method: 'initialize',
    })
    expect(before.status).toBe(200)

    const replay = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })
    expect(replay.status).toBe(400)

    const unknown = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'this-code-was-never-issued',
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })
    expect(unknown.status).toBe(replay.status)
    expect(unknown.body).toEqual(replay.body)

    // And the tokens the honest exchange produced are gone, not merely the
    // replay refused — the standard's answer to "this code leaked".
    const after = await mcp(tokens.access_token, {
      jsonrpc: '2.0',
      id: 91,
      method: 'initialize',
    })
    expect(after.status).toBe(401)
  })

  it('does not burn a code on a wrong redirect URI, so a legitimate retry still works', async () => {
    // The ordering question the plan doc raises: nothing may consume the row
    // before every binding on it — including the redirect URI — has matched.
    const session = await registerUser('ordering@example.test')
    const client = await registerClientDirect()
    const { verifier, challenge } = pkce()
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
    )
    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
      .send({})
    const code = new URL(approve.body.redirectTo).searchParams.get('code')!

    const wrongRedirect = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://not-the-registered-callback.example/cb',
      })
    expect(wrongRedirect.status).toBe(400)

    // The same code, presented with the correct redirect URI, still works —
    // the wrong attempt above did not consume it.
    const correctRedirect = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })
    expect(correctRedirect.status).toBe(200)
  })
})

/**
 * Finding 3: rotation is correct (a refresh token is worth one exchange),
 * but replaying an already-rotated-out token was silently refused, which
 * discards the one case that signal actually means something — a race the
 * legitimate client lost to a thief who rotated first.
 */
describe('replaying an already-rotated refresh token', () => {
  it('ends the whole connection, not just the one exchange, and tells the user', async () => {
    const session = await registerUser('rotation-reuse@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)

    const rotated = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(rotated.status).toBe(200)

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // Replay the ORIGINAL, now-superseded token — the stolen-token race,
    // presented by whichever side lost it.
    const replay = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(replay.status).toBe(400)

    // The legitimate side's rotated-to access token is dead too: the
    // connection was ended outright, which is the only visible trace of the
    // attempt a user gets.
    const afterReplay = await mcp(rotated.body.access_token, {
      jsonrpc: '2.0',
      id: 92,
      method: 'initialize',
    })
    expect(afterReplay.status).toBe(401)

    // And they are told, via whatever notification path already exists
    // (the best-effort account mailer — MAIL_PROVIDER=log in tests, so the
    // send lands in the console rather than an inbox).
    expect(
      infoSpy.mock.calls.some(([line]) =>
        String(line).includes('was disconnected'),
      ),
    ).toBe(true)
    infoSpy.mockRestore()
  })

  it('leaves an unrelated, never-rotated refresh token alone', async () => {
    // Both connections share the same registered client on purpose (E5,
    // rework round 1 — an earlier version of this comment said "a different
    // client registration", which was never true of the test itself): what
    // must hold is that a revocation triggered by one *connection* — one
    // token family — never reaches a second, unrelated one even when they
    // share a (user, client) pair the old `disconnect`-based design keyed
    // its blast radius on.
    const session = await registerUser('rotation-unrelated@example.test')
    const other = await registerUser('rotation-bystander@example.test')
    const preset = await registerClientDirect()
    const first = await connect(session, undefined, preset)
    const second = await connect(other, undefined, preset)

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: first.tokens.refresh_token,
      client_id: first.client.client_id,
    })
    // Replay first's now-superseded token.
    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: first.tokens.refresh_token,
      client_id: first.client.client_id,
    })

    // second's connection, a different user through the same client, is
    // untouched.
    const stillWorks = await mcp(second.tokens.access_token, {
      jsonrpc: '2.0',
      id: 93,
      method: 'initialize',
    })
    expect(stillWorks.status).toBe(200)
  })

  it('does not touch a second connection the same user holds through the same client', async () => {
    // The coordinator's own phrasing for root cause A3's blast-radius bug:
    // "where one user holds two connections through one client_id, a replay
    // on one kills the other". Distinct from the test above, which varies
    // the user — this varies nothing but the connection itself.
    const session = await registerUser('sameuser-twoconns@example.test')
    const preset = await registerClientDirect()
    const first = await connect(session, undefined, preset)
    const second = await connect(session, undefined, preset)

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: first.tokens.refresh_token,
      client_id: preset.client_id,
    })
    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: first.tokens.refresh_token,
      client_id: preset.client_id,
    })

    const secondStillWorks = await mcp(second.tokens.access_token, {
      jsonrpc: '2.0',
      id: 94,
      method: 'initialize',
    })
    expect(secondStillWorks.status).toBe(200)
  })

  it('catches reuse even after two further rotations, not only the immediate successor', async () => {
    // Root cause A3's first bug: the old design only recorded one hop of
    // rotation history, so replaying a token more than one generation back
    // was invisible. The family/grace redesign does not chain-walk at all —
    // it reads the presented token's own row, which still knows its family
    // and its own supersession regardless of how many further rotations
    // happened after it — so this is the regression test for that no longer
    // being a limitation.
    const session = await registerUser('deep-reuse@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)
    const original = tokens.refresh_token

    const rotate = (refreshToken: string) =>
      request(server).post('/oauth/token').type('form').send({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.client_id,
      })

    const first = await rotate(original)
    expect(first.status).toBe(200)
    const second = await rotate(first.body.refresh_token)
    expect(second.status).toBe(200)

    // Replay the ORIGINAL token — two generations behind what is live now.
    const replay = await rotate(original)
    expect(replay.status).toBe(400)

    // The whole family is gone, including the twice-rotated-forward pair.
    const afterReplay = await mcp(second.body.access_token, {
      jsonrpc: '2.0',
      id: 95,
      method: 'initialize',
    })
    expect(afterReplay.status).toBe(401)
  })
})

/**
 * Root cause A (rework round 1): code-replay revocation used to snapshot
 * the minted tokens' hashes onto the grant row in a second, non-atomic
 * write. A stolen code redeemed and then immediately rotated left both
 * hashes dead, and a genuinely concurrent double exchange left them unset
 * entirely — either way, nothing to revoke. The fix gives every token a
 * family id (the authorization code's own `codeHash`) that survives any
 * number of rotations and needs no snapshot.
 */
describe('code-replay revocation survives rotation and races', () => {
  it('revokes tokens even after they have since rotated', async () => {
    // The measured failure from both reviews: attacker redeems the code,
    // rotates immediately (a legitimate rotation — finding 3 has nothing to
    // fire on), then the code is replayed by whoever else was holding it. A
    // hash snapshot taken once at exchange time is already stale by then.
    const session = await registerUser('a1-rotate-first@example.test')
    const preset = await registerClientDirect()
    const { client, code, verifier, tokens } = await connect(
      session,
      undefined,
      preset,
    )

    const rotated = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(rotated.status).toBe(200)

    const replay = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })
    expect(replay.status).toBe(400)

    // The rotated pair — several steps removed from what the code itself
    // minted — is dead too.
    const afterRotate = await mcp(rotated.body.access_token, {
      jsonrpc: '2.0',
      id: 96,
      method: 'initialize',
    })
    expect(afterRotate.status).toBe(401)
  })

  it('revokes both sides of a genuinely concurrent double exchange', async () => {
    // The other measured failure: two requests racing on the same code at
    // the database level. The atomic claim lets exactly one win, but the
    // loser can reach the revocation check before the winner's `issueTokens`
    // (a second, later operation) has finished writing anything to revoke.
    const session = await registerUser('a2-concurrent@example.test')
    const client = await registerClientDirect()
    const { verifier, challenge } = pkce()
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      challenge,
    )
    const approve = await request(server)
      .post(`/api/oauth/authorization/${requestId}/approve`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
      .send({})
    const code = new URL(approve.body.redirectTo).searchParams.get('code')!

    const exchangeOnce = () =>
      request(server).post('/oauth/token').type('form').send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: 'https://assistant.test/cb',
      })

    const [a, b] = await Promise.all([exchangeOnce(), exchangeOnce()])
    const [winner, loser] = a.status === 200 ? [a, b] : [b, a]
    expect(winner.status).toBe(200)
    expect(loser.status).toBe(400)

    // The bounded retry in `revokeFamilyIfRedeemed` must still find and
    // delete the winner's tokens, even though they did not exist yet the
    // instant the loser's claim failed.
    const stillWorks = await mcp(winner.body.access_token, {
      jsonrpc: '2.0',
      id: 97,
      method: 'initialize',
    })
    expect(stillWorks.status).toBe(401)
  })
})

/**
 * Root cause B (rework round 1): rotation used to delete the presented
 * token immediately, so a lost response's retry — the MCP SDK client has no
 * single-flight around refresh — replayed the client's own last token and
 * was torn down as if it were theft. Zero timing needed; a single dropped
 * response is enough.
 */
describe('an honest retry of a rotated token', () => {
  it('is tolerated within the grace window rather than torn down', async () => {
    const session = await registerUser('b1-honest-retry@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)

    const rotated = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(rotated.status).toBe(200)

    // Tests run with REFRESH_GRACE_SECONDS=0 (rotated-out tokens must die
    // immediately, by design — see test/integration/auth.test.ts's own
    // comment on the session-level equivalent). Simulate a positive grace
    // window the same way that file does: extend the already-shortened
    // superseded row directly, rather than reconfiguring env per test.
    await OAuthTokenModel.updateOne(
      { tokenHash: hashToken(tokens.refresh_token) },
      { $set: { expiresAt: new Date(Date.now() + 60_000) } },
    )

    const withinGrace = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    expect(withinGrace.status).toBe(200)

    // Not a teardown: the pair minted moments earlier by the first rotation
    // is untouched.
    const stillWorks = await mcp(rotated.body.access_token, {
      jsonrpc: '2.0',
      id: 98,
      method: 'initialize',
    })
    expect(stillWorks.status).toBe(200)
  })
})

/**
 * Root cause C1/C3 (rework round 1): a merely `httpOnly`/`SameSite=Lax`
 * cookie can still be *planted* — an attacker parks their own flow and hands
 * the victim the resulting cookie's value to set for themselves, since
 * cookies are not origin-isolated by default. `__Host-` closes that by
 * making the browser refuse the cookie unless it also carries `Secure`, no
 * `Domain`, and `Path=/` — properties enforced by real browsers, which
 * `supertest` does not implement. Asserting the server actually emits them
 * is the executable proxy for that property at this layer; the isolation
 * itself is not independently exercisable without a real browser (the
 * reasoning is recorded in full where the cookie options are defined,
 * oauth/provider.ts).
 */
describe("the binding cookie's own attributes", () => {
  it('carries every attribute the origin-isolation property depends on', async () => {
    const client = await registerClientDirect()
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
    const raw = rawConsentCookie(authorize, requestId)

    expect(raw).toMatch(/^__Host-sm_oauth_consent_/)
    expect(raw).toMatch(/HttpOnly/i)
    expect(raw).toMatch(/Secure/i)
    expect(raw).toMatch(/SameSite=Lax/i)
    expect(raw).toMatch(/Path=\//)
    expect(raw).not.toMatch(/Domain=/i)
  })
})

/**
 * Root cause C4 (rework round 1): one fixed cookie name meant a second
 * `/oauth/authorize` — a second assistant, a double-clicked Connect button —
 * silently overwrote the first flow's cookie, orphaning it with no way to
 * recover except starting over (the refusal is deliberately indistinguishable
 * from the attack case).
 */
describe('a second parked flow', () => {
  it('does not orphan the first — each request gets its own cookie', async () => {
    const session = await registerUser('c4-two-flows@example.test')
    const client = await registerClientDirect()

    const first = await beginAuthorize(client.client_id, pkce().challenge)
    const second = await beginAuthorize(client.client_id, pkce().challenge)
    expect(first.requestId).not.toBe(second.requestId)

    const firstGet = await request(server)
      .get(`/api/oauth/authorization/${first.requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', first.cookie)
    expect(firstGet.status).toBe(200)

    const secondGet = await request(server)
      .get(`/api/oauth/authorization/${second.requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', second.cookie)
    expect(secondGet.status).toBe(200)
  })
})

/**
 * Root cause D1 (rework round 1): `redirectHost` used `URL.hostname`, which
 * drops the port a loopback client (RFC 8252) is told apart by, and is
 * actively misleading for a custom-scheme redirect URI — `myapp://cb/x`
 * read as the host `cb`, an attacker-chosen string shaped like a real one.
 * `origin` fixes the first case and is honest about the second: WHATWG URL
 * gives the literal string `"null"` for a non-special scheme's origin, which
 * is why that case falls back to the whole URI instead.
 */
describe('what the consent screen says about where access goes', () => {
  it('includes the port for a loopback redirect client', async () => {
    const session = await registerUser('d1-loopback@example.test')
    const redirectUri = 'http://127.0.0.1:51234/cb'
    const client = await registerClientDirect(redirectUri)
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      pkce().challenge,
      [SCOPES.read],
      redirectUri,
    )

    const res = await request(server)
      .get(`/api/oauth/authorization/${requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
    expect(res.body.redirectTarget).toBe('http://127.0.0.1:51234')
  })

  it('falls back to the whole URI for a custom-scheme redirect, not a misleading fragment', async () => {
    const session = await registerUser('d1-customscheme@example.test')
    const redirectUri = 'com.example.app:/oauth2redirect'
    const client = await registerClientDirect(redirectUri)
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      pkce().challenge,
      [SCOPES.read],
      redirectUri,
    )

    const res = await request(server)
      .get(`/api/oauth/authorization/${requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
    expect(res.body.redirectTarget).toBe(redirectUri)
  })
})

/**
 * Root cause D2 (rework round 1): the only way a session can authenticate
 * yet name an account that does not load is a deleted account with a still
 * valid JWT. The old code rendered a hardcoded "your account" into a
 * translated sentence and *affirmed* a connection was about to happen; the
 * fix refuses exactly like any other invalid session.
 */
describe('a session whose account no longer exists', () => {
  it('refuses the consent read rather than affirming a connection', async () => {
    const session = await registerUser('d2-ghost@example.test')
    const client = await registerClientDirect()
    const { requestId, cookie } = await beginAuthorize(
      client.client_id,
      pkce().challenge,
    )
    await UserModel.deleteOne({ email: 'd2-ghost@example.test' })

    const res = await request(server)
      .get(`/api/oauth/authorization/${requestId}`)
      .set('Authorization', `Bearer ${session}`)
      .set('Cookie', cookie)
    expect(res.status).toBe(401)
  })
})

/**
 * Root cause F1/F2/F3 (rework round 1): a lookup failure during reuse
 * detection must not surface as a 500 (F1); the notify/log side effects
 * must not make a refusal wait on a real mail round trip, which would be a
 * timing oracle (F2); and a teardown must leave a trace even when mail is
 * not configured, which is a real, documented deployment state (F3).
 */
describe('robustness of the revocation side effects', () => {
  it('answers a lookup failure with an ordinary refusal, not a 500', async () => {
    const session = await registerUser('f1-lookup-fails@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)

    const findOneSpy = vi
      .spyOn(OAuthTokenModel, 'findOne')
      .mockRejectedValueOnce(new Error('boom'))

    const res = await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })
    expect(res.status).toBe(400)

    findOneSpy.mockRestore()
  })

  it('does not make a token refusal wait on a slow mail relay', async () => {
    const session = await registerUser('f2-slow-mail@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })

    let resolveMail: () => void = () => {}
    const mailSpy = vi.spyOn(mailer, 'sendMail').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveMail = () => resolve()
        }),
    )

    const start = Date.now()
    const replay = await request(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    const elapsed = Date.now() - start

    expect(replay.status).toBe(400)
    // Well under lib/mailer.ts's own SMTP timeouts (10s connect, 10s
    // greeting, 20s socket) — proves the response did not wait on the mail
    // promise, which is still unresolved at this point.
    expect(elapsed).toBeLessThan(1000)

    // The fire-and-forget notify call (root cause F2) is, by construction,
    // still pending past the point the HTTP response already returned —
    // that is the property this test exists to prove. Left completely
    // unresolved, it would straggle into the next test's `beforeEach`
    // collection wipe and read/write against collections that test does not
    // expect touched. Resolve it and give the continuation a turn before
    // moving on, so the test's own untidiness does not leak sideways.
    resolveMail()
    await new Promise(resolve => setTimeout(resolve, 20))
    mailSpy.mockRestore()
  })

  it('leaves a trace of the teardown even when mail is unavailable', async () => {
    const session = await registerUser('f3-no-mail@example.test')
    const preset = await registerClientDirect()
    const { client, tokens } = await connect(session, undefined, preset)

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })

    const mailerAvailableSpy = vi
      .spyOn(mailer, 'mailerAvailable')
      .mockReturnValue(false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })

    expect(
      errorSpy.mock.calls.some(([line]) =>
        String(line).includes('[oauth] connection revoked'),
      ),
    ).toBe(true)

    mailerAvailableSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('leaves the same trace for a replayed authorization code', async () => {
    // F3's justification for telling the user at all applies to finding 2's
    // revocation path just as much as finding 3's, and both now go through
    // the same `endFamily` helper — this confirms the code path does too.
    const session = await registerUser('f3-code-replay@example.test')
    const preset = await registerClientDirect()
    const { client, code, verifier } = await connect(session, undefined, preset)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(server).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: 'https://assistant.test/cb',
    })

    expect(
      errorSpy.mock.calls.some(([line]) =>
        String(line).includes('[oauth] connection revoked'),
      ),
    ).toBe(true)

    errorSpy.mockRestore()
  })
})
