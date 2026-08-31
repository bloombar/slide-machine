/**
 * Google account *connect* flow for quiz publishing (SPEC EXP-4 / QUIZ-4).
 * Separate from sign-in (auth/google.ts): it requests per-file Drive access
 * with OFFLINE access so the server gets a refresh token and can create
 * a Form in the instructor's Drive later, on their behalf. The refresh token
 * is encrypted at rest (token-crypto.ts); this module only builds the consent
 * URL, exchanges the code, and mints an authorized client for the library.
 */
import { OAuth2Client } from 'google-auth-library'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import { CapabilityRequiredError } from '../actions/dispatch'

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
 * One scope, deliberately (docs/GOOGLE_API_KEYS.md §6).
 *
 * `drive.file` is per-file: it covers what this app creates and what the user
 * hands it by picking the file in Google's Picker. That is enough for every
 * Google call the app makes — quiz publishing (`forms.create`,
 * `forms.batchUpdate`, `forms.get` all accept it, and the app only ever
 * touches a Form it created), deck and template export, reading a picked
 * presentation for import (`presentations.get` accepts it too), and trashing
 * a published Form.
 *
 * It is also the only Drive scope Google classes as non-sensitive. The
 * `forms.body*` pair it replaces are sensitive, and `drive.readonly` is
 * restricted — that one alone would oblige the deployment to pass a paid
 * third-party security assessment every year, and it bought exactly one
 * thing: `files.list`, the app browsing a Drive itself. Google's Picker does
 * the browsing now (docs/GOOGLE_PRODUCTION_MODE.md).
 *
 * Instructors must reconnect once after a scope is genuinely added, so their
 * stored token carries it.
 */
const CONNECT_SCOPES = ['https://www.googleapis.com/auth/drive.file']

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

/** The consent URL to send the browser to, requesting offline Drive access.
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

/** The refresh token plus the scopes Google actually granted (which can be
 * fewer than requested — the consent screen lets users untick permissions). */
export interface ConnectTokens {
  refreshToken: string
  scope: string
}

/**
 * Exchanges the authorization code for tokens and returns the refresh token
 * together with the granted scope string. Throws a 401 if the exchange fails or
 * Google returns no refresh token.
 */
export const exchangeConnectCode = async (
  code: string,
  requestOrigin: string,
): Promise<ConnectTokens> => {
  const { id, secret } = requireConfigured()
  const client = new OAuth2Client({
    clientId: id,
    clientSecret: secret,
    redirectUri: connectRedirectUri(requestOrigin),
  })
  try {
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token) throw new Error('no refresh token')
    return { refreshToken: tokens.refresh_token, scope: tokens.scope ?? '' }
  } catch {
    throw new HttpError(
      401,
      'google_connect_failed',
      'Could not connect the Google account',
    )
  }
}

/**
 * The scope a connection must carry to save to and read from Drive.
 *
 * Google's granular consent lets a user grant sign-in but untick this,
 * yielding a token that 403s on every Drive call — so the connect flow
 * verifies it is present rather than assuming the request succeeded.
 */
const REQUIRED_CONNECT_SCOPES = ['https://www.googleapis.com/auth/drive.file']

/** Whether the granted scope string carries the Drive access the app needs. */
export const grantedDriveAccess = (scope: string): boolean => {
  const granted = new Set(scope.split(' ').filter(Boolean))
  return REQUIRED_CONNECT_SCOPES.every(s => granted.has(s))
}

/** An authorized OAuth2 client for the connected account, for API/library calls. */
export const clientForRefreshToken = (refreshToken: string): OAuth2Client => {
  const { id, secret } = requireConfigured()
  const client = new OAuth2Client({ clientId: id, clientSecret: secret })
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

/**
 * A bearer token for the connected account, for calling a Google REST API by
 * hand where no client library fits — reading a presentation (TMPL-8).
 *
 * Throws rather than returning an empty string: a caller that carried on with
 * no token would get a 401 it could only report as "Google said no", which
 * hides a stored grant that has been revoked.
 */
export const accessTokenFor = async (refreshToken: string): Promise<string> => {
  // A stored grant that Google will no longer exchange is the account no
  // longer being connected, whatever the wording of the refusal — revoked in
  // the user's Google settings, expired, or issued by credentials this
  // deployment has since replaced. Raised as the same thing a missing
  // connection raises, so the screen offers to reconnect.
  //
  // It threw a plain Error before, which reached the user as "Something went
  // wrong on our end" — a server fault they could only wait out, for
  // something one click would have fixed.
  let token: string | null | undefined
  try {
    ;({ token } = await clientForRefreshToken(refreshToken).getAccessToken())
  } catch {
    throw new CapabilityRequiredError(
      'google-drive',
      'Your Google connection has expired — reconnect the account',
    )
  }
  if (!token) {
    throw new CapabilityRequiredError(
      'google-drive',
      'Google would not issue an access token — reconnect the account',
    )
  }
  return token
}
