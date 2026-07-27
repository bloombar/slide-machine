/**
 * Unit tests for the Google connect helpers (EXP-4/QUIZ-4): signed state
 * round-trip and rejection, the offline consent URL, the code→refresh-token
 * exchange (google-auth-library mocked), and building an authorized client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { testEnv, getToken, setCredentials } = vi.hoisted(() => ({
  testEnv: {
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters!',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id' as string | undefined,
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' as string | undefined,
    PUBLIC_BASE_URL: 'http://localhost:3000' as string | undefined,
  },
  getToken: vi.fn(),
  setCredentials: vi.fn(),
}))
vi.mock('../config/env', () => ({ env: testEnv }))
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    getToken = getToken
    setCredentials = setCredentials
  },
}))

import {
  signConnectState,
  verifyConnectState,
  buildConnectUrl,
  connectRedirectUri,
  exchangeConnectCode,
  grantedDriveAccess,
  clientForRefreshToken,
} from './google-connect'

beforeEach(() => {
  testEnv.GOOGLE_OAUTH_CLIENT_ID = 'client-id'
  testEnv.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'
  getToken.mockReset()
  setCredentials.mockReset()
})

describe('connect state', () => {
  it('round-trips a signed state', async () => {
    const token = await signConnectState({ userId: 'u1', returnTo: '/d/x' })
    expect(await verifyConnectState(token)).toEqual({
      userId: 'u1',
      returnTo: '/d/x',
    })
  })

  it('rejects a tampered or bogus state', async () => {
    await expect(verifyConnectState('not.a.jwt')).rejects.toThrow()
  })
})

describe('buildConnectUrl', () => {
  it('requests the Forms/Drive scopes with offline access', async () => {
    const url = new URL(buildConnectUrl('the-state', ''))
    expect(url.host).toBe('accounts.google.com')
    const scope = url.searchParams.get('scope')!
    expect(scope).toContain('auth/forms.body')
    expect(scope).toContain('auth/drive.file')
    // Browsing the instructor's existing Drive folders (QUIZ-2 finder)
    expect(scope).toContain('auth/drive.readonly')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('the-state')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
  })

  it('adds login_hint only when a hint is given (pre-selects the account)', () => {
    expect(
      new URL(buildConnectUrl('s', '')).searchParams.get('login_hint'),
    ).toBeNull()
    const url = new URL(buildConnectUrl('s', '', 'ada@example.com'))
    expect(url.searchParams.get('login_hint')).toBe('ada@example.com')
  })

  it('uses PUBLIC_BASE_URL for the redirect URI', () => {
    expect(connectRedirectUri('http://ignored')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
  })

  it('is unavailable (503) without OAuth credentials', () => {
    testEnv.GOOGLE_OAUTH_CLIENT_ID = undefined
    expect(() => buildConnectUrl('s', '')).toThrow(/not configured/)
  })
})

describe('exchangeConnectCode', () => {
  it('returns the refresh token and granted scope from a successful exchange', async () => {
    getToken.mockResolvedValue({
      tokens: { refresh_token: 'refresh-123', scope: 'a b' },
    })
    expect(await exchangeConnectCode('code', '')).toEqual({
      refreshToken: 'refresh-123',
      scope: 'a b',
    })
    expect(getToken).toHaveBeenCalledWith('code')
  })

  it('defaults the scope to empty when Google omits it', async () => {
    getToken.mockResolvedValue({ tokens: { refresh_token: 'r' } })
    expect((await exchangeConnectCode('code', '')).scope).toBe('')
  })

  it('throws when Google returns no refresh token', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'a' } })
    await expect(exchangeConnectCode('code', '')).rejects.toThrow(
      /Could not connect/,
    )
  })

  it('throws when the exchange fails', async () => {
    getToken.mockRejectedValue(new Error('bad code'))
    await expect(exchangeConnectCode('code', '')).rejects.toThrow(
      /Could not connect/,
    )
  })
})

describe('grantedDriveAccess', () => {
  const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'
  const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'

  it('is true when both Drive scopes are granted', () => {
    expect(grantedDriveAccess(`openid ${DRIVE_FILE} ${DRIVE_READONLY}`)).toBe(
      true,
    )
  })

  it('is false when a Drive scope is missing (granular consent unticked)', () => {
    // Identity-only grant — the exact shape that dead-ended the folder picker.
    expect(
      grantedDriveAccess(
        'openid https://www.googleapis.com/auth/userinfo.email',
      ),
    ).toBe(false)
    // Only one of the two Drive scopes is not enough.
    expect(grantedDriveAccess(DRIVE_FILE)).toBe(false)
  })

  it('is false for an empty scope string', () => {
    expect(grantedDriveAccess('')).toBe(false)
  })
})

describe('clientForRefreshToken', () => {
  it('sets the refresh token on the client', () => {
    clientForRefreshToken('refresh-xyz')
    expect(setCredentials).toHaveBeenCalledWith({
      refresh_token: 'refresh-xyz',
    })
  })
})
