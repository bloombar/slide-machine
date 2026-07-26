/**
 * Integration tests for the LIVE quiz publishing path (QUIZ_PUBLISH_MODE=live).
 * The Google boundaries (connect helpers, Drive/Forms service, token crypto)
 * are mocked, so this exercises the real action + route wiring — connect
 * returns a consent redirect, the callback stores the encrypted token, and
 * folders/publish go through the live service — without contacting Google.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import request from 'supertest'

const state = vi.hoisted(() => ({ userId: '' }))

vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, QUIZ_PUBLISH_MODE: 'live' } }
})
vi.mock('../../src/auth/google-connect', () => ({
  signConnectState: vi.fn(async () => 'signed-state'),
  buildConnectUrl: vi.fn(
    () => 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
  ),
  verifyConnectState: vi.fn(async () => ({
    userId: state.userId,
    returnTo: 'http://localhost:5173/d/x',
  })),
  exchangeConnectCode: vi.fn(async () => 'refresh-token-123'),
}))
vi.mock('../../src/lib/quiz-google', () => ({
  listDriveFoldersLive: vi.fn(async () => [{ id: 'f1', name: 'Quizzes' }]),
  createDriveFolderLive: vi.fn(
    async (_t: string, name: string, _parentId?: string) => ({
      id: 'live-folder-1',
      name,
    }),
  ),
  publishQuizLive: vi.fn(async () => ({
    formId: 'F1',
    formUrl: 'https://docs.google.com/forms/d/F1/viewform',
  })),
  deleteQuizLive: vi.fn(async () => undefined),
}))
vi.mock('../../src/lib/token-crypto', () => ({
  encryptToken: vi.fn((t: string) => `enc:${t}`),
  decryptToken: vi.fn((t: string) => t.replace(/^enc:/, '')),
}))

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> =>
  (
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: 'longenough1', displayName: 'x' })
  ).body.accessToken

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let adaId: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({ email: 'ada@example.com' }))!.id
  state.userId = adaId
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
    templateId: 'classic',
  })
  deckId = deck.body.id
  await act(ada, 'session.phrase', {
    deckId,
    phrase: 'Photosynthesis occurs in chloroplasts',
  })
})

describe('quiz actions (live mode)', () => {
  it('connect returns a Google consent redirect', async () => {
    const res = await act(ada, 'quiz.connectGoogle', {
      returnTo: 'http://localhost:5173/d/x',
    })
    expect(res.body).toEqual({
      status: 'redirect',
      url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    })
    // Also works without a returnTo (falls back to the app origin)
    const noReturn = await act(ada, 'quiz.connectGoogle')
    expect(noReturn.body.status).toBe('redirect')
  })

  it('pre-selects the account (login_hint) when the user signed in with Google', async () => {
    const { buildConnectUrl } = await import('../../src/auth/google-connect')
    const mock = buildConnectUrl as unknown as {
      mockClear: () => void
      mock: { calls: unknown[][] }
    }
    // A Google-signed-in user: their email is passed as the login hint.
    await UserModel.updateOne({ _id: adaId }, { googleId: 'g-abc' })
    mock.mockClear()
    await act(ada, 'quiz.connectGoogle')
    expect(mock.mock.calls.at(-1)![2]).toBe('ada@example.com')

    // A password-only user (no googleId) gets no hint.
    await UserModel.updateOne({ _id: adaId }, { $unset: { googleId: '' } })
    mock.mockClear()
    await act(ada, 'quiz.connectGoogle')
    expect(mock.mock.calls.at(-1)![2]).toBeUndefined()
  })

  it('the connect callback stores the encrypted token and connects the user', async () => {
    const res = await request(server).get(
      '/api/auth/google/connect/callback?code=abc&state=signed-state',
    )
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:5173/d/x')
    const user = await UserModel.findById(adaId).select(
      '+googleQuizRefreshToken',
    )
    expect(user!.googleConnected).toBe(true)
    expect(user!.googleQuizRefreshToken).toBe('enc:refresh-token-123')
  })

  it('completes the connect through the shared SIGN-IN callback URI', async () => {
    // The connect reuses /api/auth/google/callback (already registered), and a
    // connect state routes to the connect logic there — no dedicated URI.
    const res = await request(server).get(
      '/api/auth/google/callback?code=abc&state=signed-state',
    )
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:5173/d/x')
    const user = await UserModel.findById(adaId).select(
      '+googleQuizRefreshToken',
    )
    expect(user!.googleConnected).toBe(true)
    expect(user!.googleQuizRefreshToken).toBe('enc:refresh-token-123')
  })

  it('a bad callback state redirects without storing anything', async () => {
    const { verifyConnectState } = await import('../../src/auth/google-connect')
    vi.mocked(verifyConnectState).mockRejectedValueOnce(new Error('bad state'))
    const res = await request(server).get(
      '/api/auth/google/connect/callback?code=abc&state=bad',
    )
    expect(res.status).toBe(302)
    const user = await UserModel.findById(adaId).select(
      '+googleQuizRefreshToken',
    )
    expect(user!.googleConnected).toBeFalsy()
  })

  it('creates a Drive folder in live mode', async () => {
    await UserModel.updateOne(
      { _id: adaId },
      {
        googleConnected: true,
        googleQuizRefreshToken: 'enc:refresh-token-123',
      },
    )
    const res = await act(ada, 'quiz.createFolder', { name: 'Week 5 quizzes' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'live-folder-1', name: 'Week 5 quizzes' })
  })

  it('lists live folders and publishes through the library once connected', async () => {
    await UserModel.updateOne(
      { _id: adaId },
      {
        googleConnected: true,
        googleQuizRefreshToken: 'enc:refresh-token-123',
      },
    )
    const folders = await act(ada, 'quiz.driveFolders')
    expect(folders.body.folders).toEqual([{ id: 'f1', name: 'Quizzes' }])

    const publish = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    expect(publish.status).toBe(200)
    expect(publish.body.formUrl).toBe(
      'https://docs.google.com/forms/d/F1/viewform',
    )
  })

  it('does not treat a stale mock-mode flag as connected in live mode', async () => {
    // googleConnected true but no real token (e.g. connected in mock earlier)
    await UserModel.updateOne({ _id: adaId }, { googleConnected: true })
    const status = await act(ada, 'quiz.status', { deckId })
    expect(status.body.googleConnected).toBe(false)
  })

  it('publish fails if connected but the stored token is gone', async () => {
    // googleConnected without a token (edge/corruption) → forbidden, not 500
    await UserModel.updateOne({ _id: adaId }, { googleConnected: true })
    const res = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })
})
