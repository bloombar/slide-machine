/**
 * Integration tests for the Google sign-in routes against a real MongoDB.
 * Only Google's network boundary is mocked (exchangeCode); the state
 * cookie, account find-or-create/link, session cookie, and redirects are
 * all exercised for real.
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
import type { GoogleProfile } from '../../src/auth/google'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { hashPassword } from '../../src/auth/password'

// Mock Google's network call and the configured-flag; keep the real URL
// builders so /start still produces a genuine consent URL
vi.mock('../../src/auth/google', async importActual => ({
  ...(await importActual<typeof import('../../src/auth/google')>()),
  exchangeCode: vi.fn(),
  googleAuthConfigured: vi.fn(() => true),
}))
const { exchangeCode, googleAuthConfigured } =
  await import('../../src/auth/google')

const server = createApp().listen(0)
afterAll(() => server.close())

const profile = (over: Partial<GoogleProfile> = {}): GoogleProfile => ({
  googleId: 'google-sub-1',
  email: 'ada@nyu.edu',
  emailVerified: true,
  name: 'Ada Lovelace',
  ...over,
})

const stateCookie = (res: request.Response): string => {
  const cookie = res
    .get('Set-Cookie')
    ?.find(c => c.startsWith('sm_oauth_state='))
  return cookie?.split(';')[0] ?? ''
}

const refreshCookie = (res: request.Response): string | undefined =>
  res.get('Set-Cookie')?.find(c => c.startsWith('sm_refresh='))

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), RefreshTokenModel.init()])
})
afterAll(async () => {
  await disconnectMongo()
})
beforeEach(async () => {
  vi.mocked(exchangeCode).mockReset()
  await Promise.all([
    UserModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
})

describe('GET /api/auth/google/start', () => {
  it('sets a state cookie and redirects to Google consent', async () => {
    const res = await request(server).get('/api/auth/google/start')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.location!)
    expect(location.host).toBe('accounts.google.com')
    // The state in the URL must match the one stashed in the cookie
    const cookieState = stateCookie(res).split('=')[1]
    expect(location.searchParams.get('state')).toBe(cookieState)
  })

  it('is unavailable when Google sign-in is not configured', async () => {
    vi.mocked(googleAuthConfigured).mockReturnValueOnce(false)
    const res = await request(server).get('/api/auth/google/start')
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('google_auth_unavailable')
  })
})

describe('GET /api/auth/google/callback', () => {
  /** Runs a callback carrying a matching state cookie, as the browser would. */
  const callback = (code: string, state: string) =>
    request(server)
      .get(`/api/auth/google/callback?code=${code}&state=${state}`)
      .set('Cookie', `sm_oauth_state=${state}`)

  it('creates a new account on first Google sign-in', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(profile())
    const res = await callback('auth-code', 'st8')

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:3000/app')
    expect(refreshCookie(res)).toBeDefined()

    const user = await UserModel.findOne({ email: 'ada@nyu.edu' })
    expect(user?.googleId).toBe('google-sub-1')
    expect(user?.emailVerified).toBe(true)
    expect(user?.passwordHash).toBeUndefined()
  })

  it('links Google onto an existing password account with the same email', async () => {
    await UserModel.create({
      email: 'ada@nyu.edu',
      displayName: 'Ada',
      passwordHash: await hashPassword('longenough1'),
      emailVerified: true,
    })
    vi.mocked(exchangeCode).mockResolvedValue(profile())
    await callback('auth-code', 'st8')

    // One account, now carrying the Google link — not a duplicate
    const users = await UserModel.find({ email: 'ada@nyu.edu' })
    expect(users).toHaveLength(1)
    expect(users[0]!.googleId).toBe('google-sub-1')
  })

  it('fills an empty avatar from the Google picture when linking', async () => {
    await UserModel.create({
      email: 'ada@nyu.edu',
      displayName: 'Ada',
      passwordHash: await hashPassword('longenough1'),
      emailVerified: true,
    })
    vi.mocked(exchangeCode).mockResolvedValue(
      profile({ picture: 'https://pic.example/ada.png' }),
    )
    await callback('auth-code', 'st8')
    const user = await UserModel.findOne({ email: 'ada@nyu.edu' })
    expect(user?.avatarUrl).toBe('https://pic.example/ada.png')
  })

  it('derives a display name from the email when Google sends none', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(
      profile({ name: undefined, email: 'grace@nyu.edu' }),
    )
    await callback('auth-code', 'st8')
    const user = await UserModel.findOne({ email: 'grace@nyu.edu' })
    expect(user?.displayName).toBe('grace')
  })

  it('signs the same Google user back in without duplicating', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(profile())
    await callback('code-1', 's1')
    await callback('code-2', 's2')
    expect(await UserModel.countDocuments({ googleId: 'google-sub-1' })).toBe(1)
  })

  it('rejects a callback whose state does not match the cookie', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(profile())
    const res = await request(server)
      .get('/api/auth/google/callback?code=c&state=forged')
      .set('Cookie', 'sm_oauth_state=real')

    expect(res.headers.location).toBe(
      'http://localhost:3000/login?error=google_auth_failed',
    )
    expect(refreshCookie(res)).toBeUndefined()
    // The forged request never reached Google
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(await UserModel.countDocuments()).toBe(0)
  })

  it('rejects a callback with no state cookie at all', async () => {
    const res = await request(server).get(
      '/api/auth/google/callback?code=c&state=s',
    )
    expect(res.headers.location).toBe(
      'http://localhost:3000/login?error=google_auth_failed',
    )
  })

  it('fails gracefully when the Google exchange throws', async () => {
    vi.mocked(exchangeCode).mockRejectedValue(
      new Error('token exchange failed'),
    )
    const res = await callback('bad-code', 'st8')
    expect(res.headers.location).toBe(
      'http://localhost:3000/login?error=google_auth_failed',
    )
    expect(refreshCookie(res)).toBeUndefined()
    expect(await UserModel.countDocuments()).toBe(0)
  })

  it('refuses an unverified Google email', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(profile({ emailVerified: false }))
    const res = await callback('auth-code', 'st8')
    expect(res.headers.location).toBe(
      'http://localhost:3000/login?error=google_auth_failed',
    )
    expect(await UserModel.countDocuments()).toBe(0)
  })
})
