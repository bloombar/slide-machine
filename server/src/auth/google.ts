/**
 * Google OAuth 2.0 sign-in (SPEC AUTH-1), server-side Authorization Code
 * flow per docs/GOOGLE_SIGN_IN.md. The browser is sent to Google's
 * consent screen; Google returns a code to the backend callback, which
 * this module exchanges for tokens and verifies. Only the basic sign-in
 * scopes are requested (openid/email/profile) — Drive scopes for EXP-4
 * come later.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const SCOPES = ['openid', 'email', 'profile']

// Google's public signing keys, fetched once and cached/rotated by jose
const jwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

/** The identity fields we take from a verified Google ID token. */
export interface GoogleProfile {
  googleId: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

/** True when both OAuth credentials are present, so the flow can run. */
export const googleAuthConfigured = (): boolean =>
  Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)

/** Throws a clear 503 when a Google route is hit without credentials. */
const requireConfigured = (): { id: string; secret: string } => {
  if (!googleAuthConfigured()) {
    throw new HttpError(
      503,
      'google_auth_unavailable',
      'Google sign-in is not configured',
    )
  }
  return {
    id: env.GOOGLE_OAUTH_CLIENT_ID!,
    secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
  }
}

/**
 * The redirect URI Google returns to. Must match a URI registered in the
 * Cloud Console byte-for-byte, so it is built from PUBLIC_BASE_URL when
 * set, otherwise from the request origin (right for localhost dev).
 */
export const redirectUri = (requestOrigin: string): string => {
  const base = env.PUBLIC_BASE_URL ?? requestOrigin
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`
}

/** The Google consent-screen URL to send the browser to. */
export const buildAuthUrl = (state: string, requestOrigin: string): string => {
  const { id } = requireConfigured()
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(requestOrigin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // Verified-email accounts need no re-consent; ask only when needed
    prompt: 'select_account',
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Exchanges an authorization code for tokens and returns the verified
 * profile from the ID token. Throws a 401 HttpError if the exchange fails
 * or the token cannot be verified.
 */
export const exchangeCode = async (
  code: string,
  requestOrigin: string,
): Promise<GoogleProfile> => {
  const { id, secret } = requireConfigured()
  const invalid = new HttpError(
    401,
    'google_auth_failed',
    'Could not sign in with Google',
  )

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(requestOrigin),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw invalid

  const token = (await res.json()) as { id_token?: string }
  if (!token.id_token) throw invalid

  let claims
  try {
    const verified = await jwtVerify(token.id_token, jwks, {
      issuer: ISSUERS,
      audience: id,
    })
    claims = verified.payload as {
      sub?: string
      email?: string
      email_verified?: boolean | string
      name?: string
      picture?: string
    }
  } catch {
    throw invalid
  }

  if (!claims.sub || !claims.email) throw invalid
  return {
    googleId: claims.sub,
    email: claims.email,
    // Google may serialize the boolean as a string in the ID token
    emailVerified:
      claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name,
    picture: claims.picture,
  }
}
