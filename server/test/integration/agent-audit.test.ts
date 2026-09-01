/**
 * What the application remembers about an assistant's work (docs/MCP.md §6).
 *
 * The premise of the MCP server is that an agent's call is an ordinary call by
 * the account that authorized it — same auth, same ownership checks, same
 * metering. That is what makes it a thin facade, and it is also why nothing
 * downstream can tell the two apart. So the only honest way to test that a
 * trail exists is to perform the **same edit twice**, once through the app's
 * own route and once through a tool, and see that exactly one of them left a
 * row. A test that only ever calls through MCP would pass just as happily if
 * the log recorded every action in the system.
 *
 * These run through the real OAuth flow rather than forging a context: the
 * channel is set in the MCP route, so a test that constructs an ActionContext
 * by hand would be checking its own fixture.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { AgentActionLogModel } from '../../src/models/agent-action-log'
import { OAuthClientModel } from '../../src/models/oauth-client'
import { OAuthTokenModel } from '../../src/models/oauth-token'
import { OAuthAuthorizationModel } from '../../src/models/oauth-authorization'
import { SCOPES } from '../../src/oauth/scopes'

const server = createApp().listen(0)
afterAll(() => server.close())

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

/** The whole authorization flow an assistant actually performs. */
const connect = async (sessionToken: string): Promise<string> => {
  const redirectUri = 'https://assistant.test/cb'
  const reg = await request(server)
    .post('/oauth/register')
    .send({
      client_name: 'Test Assistant',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
  expect(reg.status).toBe(201)

  const { verifier, challenge } = pkce()
  const authorize = await request(server)
    .get('/oauth/authorize')
    .query({
      client_id: reg.body.client_id,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: [SCOPES.read, SCOPES.write].join(' '),
      state: 'state-123',
    })
  const requestId = new URL(
    authorize.headers.location!,
    'http://localhost',
  ).searchParams.get('request')!

  const approve = await request(server)
    .post(`/api/oauth/authorization/${requestId}/approve`)
    .set('Authorization', `Bearer ${sessionToken}`)
    .send({})
  const code = new URL(approve.body.redirectTo).searchParams.get('code')!

  const token = await request(server).post('/oauth/token').type('form').send({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: reg.body.client_id,
    redirect_uri: redirectUri,
  })
  expect(token.status).toBe(200)
  return token.body.access_token as string
}

/** One tool call, as an assistant makes it. */
const callTool = (accessToken: string, name: string, args: object) =>
  request(server)
    .post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })

/** One action, as the app's own front end makes it. */
const act = (sessionToken: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${sessionToken}`)
    .send(input)

let session: string
let agentToken: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), AgentActionLogModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    AgentActionLogModel.deleteMany({}),
    OAuthClientModel.deleteMany({}),
    OAuthTokenModel.deleteMany({}),
    OAuthAuthorizationModel.deleteMany({}),
  ])

  session = await registerUser('ada@example.test')
  const project = await act(session, 'project.create', { title: 'Physics 101' })
  const deck = await act(session, 'deck.create', {
    projectId: project.body.id,
    title: 'Standing waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  agentToken = await connect(session)
  // The setup above is all app-path work; nothing it did should be in the log,
  // and the assertions below would be meaningless if it were.
  expect(await AgentActionLogModel.countDocuments({})).toBe(0)
})

describe('the same edit, through both doors', () => {
  it('records the assistant’s rename and not the instructor’s', async () => {
    await act(session, 'deck.rename', { deckId, title: 'By hand' })
    const afterHuman = await AgentActionLogModel.countDocuments({})

    const res = await callTool(agentToken, 'rename_lecture', {
      lectureId: deckId,
      title: 'By assistant',
    })
    expect(res.body.result.isError).toBeUndefined()

    const rows = await AgentActionLogModel.find({}).lean()
    // The instructor's identical edit left nothing; the assistant's left one.
    expect(afterHuman).toBe(0)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row?.action).toBe('deck.rename')
    expect(row?.channel).toBe('agent')
    expect(row?.outcome).toBe('ok')
  })

  it('names the lecture it touched, and keeps none of the words', async () => {
    await callTool(agentToken, 'rename_lecture', {
      lectureId: deckId,
      title: 'Nodes and antinodes',
    })

    const row = (await AgentActionLogModel.findOne({}).lean())!
    expect(row.deckId?.toString()).toBe(deckId)
    // The title at the time, so the row still reads once the lecture is gone.
    expect(row.deckName).toBeTruthy()
    // Deliberately no payload: tracing needs the action and the lecture, not a
    // second copy of the content (§16).
    expect(JSON.stringify(row)).not.toContain('Nodes and antinodes')
  })
})

describe('what the trail is for', () => {
  it('records a refusal as refused, not as a failure', async () => {
    // Someone else's lecture. The agent holds a genuine token for its own
    // account, so this is refused by the action's own policy — which is the
    // case worth being able to see a run of.
    const stranger = await registerUser('bystander@example.test')
    const theirProject = await act(stranger, 'project.create', { title: 'Bio' })
    const theirDeck = await act(stranger, 'deck.create', {
      projectId: theirProject.body.id,
      title: 'Mitosis',
      templateId: 'classic',
    })

    await callTool(agentToken, 'rename_lecture', {
      lectureId: theirDeck.body.id,
      title: 'Taken over',
    })

    const row = (await AgentActionLogModel.findOne({}).lean())!
    expect(row.outcome).toBe('refused')
    expect(row.errorName).toBe('ActionForbiddenError')
    // Still attributed to the account whose token was used, which is the
    // question "who let this happen" needs answered.
    expect(row.userId).toBeTruthy()
  })

  it('ties the several actions of one tool call together', async () => {
    // add_slide composes slide.add, slide.editContent, and the deck.get that
    // turns the lecture id into the address it hands back — one instruction
    // from the instructor, three rows, and the request id is what says so.
    // The read is on the trail like any other: an assistant reading a lecture
    // is a thing that happened, whatever it read it for.
    const res = await callTool(agentToken, 'add_slide', {
      lectureId: deckId,
      title: 'Nodes',
      body: 'Where the string does not move',
    })
    expect(res.body.result.isError).toBeUndefined()

    const rows = await AgentActionLogModel.find({})
      .sort({ createdAt: 1 })
      .lean()
    expect(rows.map(r => r.action)).toEqual([
      'slide.add',
      'slide.editContent',
      'deck.get',
    ])
    expect(new Set(rows.map(r => r.requestId)).size).toBe(1)
  })

  it('records a read as well as a write', async () => {
    // An assistant that read every lecture on the account did something worth
    // being able to see, even though it changed nothing.
    await callTool(agentToken, 'find_lectures', {})
    const rows = await AgentActionLogModel.find({}).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.channel === 'agent')).toBe(true)
  })
})
