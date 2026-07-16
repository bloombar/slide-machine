/**
 * Unit tests for the Google OAuth helpers. The two network dependencies —
 * Google's token endpoint (fetch) and its JWKS verification (jose) — are
 * mocked, so these exercise URL building and claim mapping offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jwtVerify } from 'jose'
import {
  buildAuthUrl,
  exchangeCode,
  googleAuthConfigured,
  redirectUri,
} from './google'

vi.mock('jose', async importActual => ({
  ...(await importActual<typeof import('jose')>()),
  jwtVerify: vi.fn(),
}))

const ORIGIN = 'http://localhost:3000'

describe('googleAuthConfigured', () => {
  it('is true when both credentials are present (test env pins them)', () => {
    expect(googleAuthConfigured()).toBe(true)
  })
})

describe('redirectUri', () => {
  it('uses PUBLIC_BASE_URL, ending at the backend callback path', () => {
    // The test env pins PUBLIC_BASE_URL to the origin
    expect(redirectUri('http://ignored')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
  })
})

describe('buildAuthUrl', () => {
  it('targets Google consent with the sign-in scopes and our state', () => {
    const url = new URL(buildAuthUrl('xyz-state', ORIGIN))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    const p = url.searchParams
    expect(p.get('client_id')).toBe('test-google-client-id')
    expect(p.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
    expect(p.get('response_type')).toBe('code')
    expect(p.get('scope')).toBe('openid email profile')
    expect(p.get('state')).toBe('xyz-state')
  })
})

// env is parsed once at import, so toggling it means re-importing the
// module with the process env stubbed
describe('without configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reports not configured and refuses to build a url', async () => {
    vi.resetModules()
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '')
    const g = await import('./google')
    expect(g.googleAuthConfigured()).toBe(false)
    expect(() => g.buildAuthUrl('s', ORIGIN)).toThrow('not configured')
  })

  it('derives the redirect uri from the request when PUBLIC_BASE_URL is unset', async () => {
    vi.resetModules()
    vi.stubEnv('PUBLIC_BASE_URL', undefined)
    const g = await import('./google')
    // Trailing slash on the origin is stripped before the path is joined
    expect(g.redirectUri('https://prod.example.com/')).toBe(
      'https://prod.example.com/api/auth/google/callback',
    )
  })
})

describe('exchangeCode', () => {
  const verified = { sub: 'g-123', email: 'ada@nyu.edu', name: 'Ada' }

  beforeEach(() => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { ...verified, email_verified: true },
    } as never)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ id_token: 'header.payload.sig' }),
      })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns the profile from a verified id token', async () => {
    const profile = await exchangeCode('the-code', ORIGIN)
    expect(profile).toEqual({
      googleId: 'g-123',
      email: 'ada@nyu.edu',
      emailVerified: true,
      name: 'Ada',
      picture: undefined,
    })
  })

  it('treats a string "true" email_verified as verified', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { ...verified, email_verified: 'true' },
    } as never)
    expect((await exchangeCode('c', ORIGIN)).emailVerified).toBe(true)
  })

  it('rejects when the token exchange call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    )
    await expect(exchangeCode('c', ORIGIN)).rejects.toThrow(
      'Could not sign in with Google',
    )
  })

  it('rejects when no id token comes back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    await expect(exchangeCode('c', ORIGIN)).rejects.toThrow(
      'Could not sign in with Google',
    )
  })

  it('rejects when the id token cannot be verified', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('bad signature'))
    await expect(exchangeCode('c', ORIGIN)).rejects.toThrow(
      'Could not sign in with Google',
    )
  })

  it('rejects a token missing the subject or email', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { email_verified: true },
    } as never)
    await expect(exchangeCode('c', ORIGIN)).rejects.toThrow(
      'Could not sign in with Google',
    )
  })
})
