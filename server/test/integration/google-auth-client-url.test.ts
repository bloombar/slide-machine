/**
 * Verifies CLIENT_APP_URL only steers the post-login *landing* (the SPA
 * origin, e.g. Vite on :5173 in local dev) while the Google OAuth callback
 * and token exchange stay pinned to PUBLIC_BASE_URL. The env module is
 * mocked so CLIENT_APP_URL is set without a real .env; the auth service and
 * Google network boundary are mocked so no database is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Override only CLIENT_APP_URL; every other value stays as the real .env
// parsed it (notably PUBLIC_BASE_URL, which the OAuth callback still uses).
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, CLIENT_APP_URL: 'http://localhost:5173' },
  }
})

// Mock Google's network call and configured-flag; keep the real URL
// builders so /start still produces a genuine consent URL.
vi.mock('../../src/auth/google', async importActual => ({
  ...(await importActual<typeof import('../../src/auth/google')>()),
  exchangeCode: vi.fn(),
  googleAuthConfigured: vi.fn(() => true),
}))

// Mock the account layer so the success path needs no database.
vi.mock('../../src/auth/service', async importActual => ({
  ...(await importActual<typeof import('../../src/auth/service')>()),
  loginWithGoogle: vi.fn(),
}))

const request = (await import('supertest')).default
const { exchangeCode } = await import('../../src/auth/google')
const { loginWithGoogle } = await import('../../src/auth/service')
const { createApp } = await import('../../src/app')

const server = createApp().listen(0)

beforeEach(() => {
  vi.mocked(exchangeCode).mockReset()
  vi.mocked(loginWithGoogle).mockReset()
})

const callback = (code: string, state: string) =>
  request(server)
    .get(`/api/auth/google/callback?code=${code}&state=${state}`)
    .set('Cookie', `sm_oauth_state=${state}`)

describe('CLIENT_APP_URL post-login landing', () => {
  it('lands a successful sign-in on the client origin, not the API origin', async () => {
    vi.mocked(exchangeCode).mockResolvedValue({
      googleId: 'g1',
      email: 'ada@nyu.edu',
      emailVerified: true,
      name: 'Ada',
    })
    vi.mocked(loginWithGoogle).mockResolvedValue({
      refreshRaw: 'refresh-token',
    } as Awaited<ReturnType<typeof loginWithGoogle>>)

    const res = await callback('auth-code', 'st8')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:5173/app')
  })

  it('sends sign-in failures to the client origin login page', async () => {
    const res = await request(server)
      .get('/api/auth/google/callback?code=c&state=forged')
      .set('Cookie', 'sm_oauth_state=real')
    expect(res.headers.location).toBe(
      'http://localhost:5173/login?error=google_auth_failed',
    )
  })

  it('keeps the OAuth redirect_uri on PUBLIC_BASE_URL, not the client origin', async () => {
    const res = await request(server).get('/api/auth/google/start')
    const consent = new URL(res.headers.location!)
    // The callback Google returns to must stay on the API origin so it
    // matches the URI registered in the Cloud Console.
    expect(consent.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
  })
})
