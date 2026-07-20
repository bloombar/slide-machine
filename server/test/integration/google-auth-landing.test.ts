/**
 * Verifies the Google OAuth callback lands the browser on a single origin:
 * both the post-login landing and the token-exchange redirect_uri use
 * PUBLIC_BASE_URL (in local dev the Vite origin, which proxies /api to
 * Express). The env module's PUBLIC_BASE_URL comes from vitest.config.ts
 * (http://localhost:3000); the auth service and Google network boundary are
 * mocked so no database is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('Google OAuth single-origin landing', () => {
  it('lands a successful sign-in on PUBLIC_BASE_URL', async () => {
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
    expect(res.headers.location).toBe('http://localhost:3000/app')
  })

  it('sends sign-in failures to the PUBLIC_BASE_URL login page', async () => {
    const res = await request(server)
      .get('/api/auth/google/callback?code=c&state=forged')
      .set('Cookie', 'sm_oauth_state=real')
    expect(res.headers.location).toBe(
      'http://localhost:3000/login?error=google_auth_failed',
    )
  })

  it('builds the OAuth redirect_uri from PUBLIC_BASE_URL', async () => {
    const res = await request(server).get('/api/auth/google/start')
    const consent = new URL(res.headers.location!)
    // The callback Google returns to must match the URI registered in the
    // Cloud Console byte-for-byte.
    expect(consent.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
  })
})
