/**
 * Google account *connect* flow for quiz publishing (SPEC EXP-4 / QUIZ-4).
 * Separate from sign-in (auth/google.ts): it requests the broader Forms/Drive
 * scopes with OFFLINE access so the server gets a refresh token and can create
 * a Form in the instructor's Drive later, on their behalf. The refresh token
 * is encrypted at rest (token-crypto.ts); this module only builds the consent
 * URL, exchanges the code, and mints an authorized client for the library.
 */
import { OAuth2Client } from 'google-auth-library'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/** Symmetric key for the signed OAuth `state` (reuses the JWT secret). */
const stateKey = (): Uint8Array => new TextEncoder().encode(env.JWT_SECRET)

/** What the connect flow carries through Google in a signed, short-lived state. */
export interface ConnectState {
  userId: string
  returnTo: string
}

/** Signs the connect state so the callback can trust it (CSRF + identity). */
export const signConnectState = (payload: ConnectState): Promise<string> =>
  new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(stateKey())

/** Verifies and decodes the connect state; throws if invalid/expired. */
export const verifyConnectState = async (
  token: string,
): Promise<ConnectState> => {
  const { payload } = await jwtVerify(token, stateKey())
  if (
    typeof payload.userId !== 'string' ||
    typeof payload.returnTo !== 'string'
  )
    throw new Error('bad connect state')
  return { userId: payload.userId, returnTo: payload.returnTo }
}

/**
 * Least-privilege scopes (docs/GOOGLE_API_KEYS.md §6). `drive.file` grants
 * write access to files this app creates (the Form + any folders it makes);
 * `drive.readonly` lets the folder picker browse the instructor's existing
 * Drive to choose a destination. Instructors must reconnect once after this
 * scope is added so their stored token carries it.
 */
const CONNECT_SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
]

/** Credentials or a clear 503 when the connect route runs unconfigured. */
const requireConfigured = (): { id: string; secret: string } => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new HttpError(
      503,
      'google_connect_unavailable',
      'Google connect is not configured',
    )
  }
  return {
    id: env.GOOGLE_OAUTH_CLIENT_ID,
    secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  }
}

/**
 * The connect callback URI; must match a Cloud Console redirect URI exactly.
 * It deliberately reuses the SIGN-IN callback (`/api/auth/google/callback`)
 * rather than a dedicated `/connect/callback`, so quiz-connect needs no extra
 * redirect URI registered in the Console — the sign-in one already is. The
 * sign-in callback tells the two flows apart by their state (see routes/auth).
 */
export const connectRedirectUri = (requestOrigin: string): string => {
  const base = env.PUBLIC_BASE_URL ?? requestOrigin
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`
}

/** The consent URL to send the browser to, requesting offline Forms/Drive access.
 * `loginHint` (the user's Google email, when they signed in with Google)
 * pre-selects the account, so the connect is a single "Allow" rather than an
 * account chooser. */
export const buildConnectUrl = (
  state: string,
  requestOrigin: string,
  loginHint?: string,
): string => {
  const { id } = requireConfigured()
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: connectRedirectUri(requestOrigin),
    response_type: 'code',
    scope: CONNECT_SCOPES.join(' '),
    state,
    access_type: 'offline',
    // Force the consent screen so a refresh token is always returned
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Exchanges the authorization code for tokens and returns the refresh token.
 * Throws a 401 if the exchange fails or Google returns no refresh token.
 */
export const exchangeConnectCode = async (
  code: string,
  requestOrigin: string,
): Promise<string> => {
  const { id, secret } = requireConfigured()
  const client = new OAuth2Client({
    clientId: id,
    clientSecret: secret,
    redirectUri: connectRedirectUri(requestOrigin),
  })
  try {
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token) throw new Error('no refresh token')
    return tokens.refresh_token
  } catch {
    throw new HttpError(
      401,
      'google_connect_failed',
      'Could not connect the Google account',
    )
  }
}

/** An authorized OAuth2 client for the connected account, for API/library calls. */
export const clientForRefreshToken = (refreshToken: string): OAuth2Client => {
  const { id, secret } = requireConfigured()
  const client = new OAuth2Client({ clientId: id, clientSecret: secret })
  client.setCredentials({ refresh_token: refreshToken })
  return client
}
