/**
 * Auth routes (SPEC AUTH-1/AUTH-2). The refresh token travels only in an
 * httpOnly SameSite=Strict cookie scoped to /api/auth; access tokens are
 * returned in the body and held in client memory.
 */
import { randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { AuthResponse } from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import { requireAuth } from '../middleware/auth'
import * as authService from '../auth/service'
import {
  buildAuthUrl,
  exchangeCode,
  googleAuthConfigured,
} from '../auth/google'
import { verifyConnectState } from '../auth/google-connect'
import {
  storeGoogleConnect,
  safeReturnTo,
  connectReturnUrl,
} from './google-connect'
import { UserModel, toUserDto } from '../models/user'
import { appOrigin } from '../lib/app-origin'
import { createRateLimiter } from '../lib/rate-limit'

export const REFRESH_COOKIE = 'sm_refresh'
export const OAUTH_STATE_COOKIE = 'sm_oauth_state'

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.NODE_ENV === 'production',
  path: '/api/auth',
} as const

const setRefreshCookie = (res: Response, raw: string): void => {
  res.cookie(REFRESH_COOKIE, raw, {
    ...cookieOptions,
    maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
  })
}

// clearCookie must repeat the same options (minus maxAge) or the browser
// keeps the cookie — an Express 5 gotcha
const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, cookieOptions)
}

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().min(1, 'Display name is required'),
  // An interface language the visitor explicitly picked before signing
  // up (TECH-12). Absent stores nothing: the account follows the browser.
  locale: z.enum(LOCALES).optional(),
})

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

const tokenSchema = z.object({ token: z.string().min(1) })

const forgotSchema = z.object({ email: z.email() })

const resetSchema = z.object({
  token: z.string().min(1),
  // The same floor registration enforces: a reset must not be a way to set a
  // weaker password than sign-up allows.
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

/** Parses a request body or throws a 400 HttpError with per-field details. */
const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body)
  if (!result.success) {
    const details = result.error.issues.map(
      i => `${i.path.join('.')}: ${i.message}`,
    )
    throw new HttpError(400, 'invalid_input', 'Invalid request', details)
  }
  return result.data
}

/**
 * Both mailed flows are open endpoints that send an email, so they carry the
 * same nuisance guard the feedback form does: enough to make scripting them
 * pointless, loose enough that nobody who genuinely mislaid a password
 * notices. Without it, either one is a way to have this server mail an
 * address of the caller's choosing, over and over.
 */
const MAIL_RATE_LIMIT = 5
const MAIL_RATE_WINDOW_MS = 15 * 60 * 1000

const mailLimiter = createRateLimiter({
  limit: MAIL_RATE_LIMIT,
  windowMs: MAIL_RATE_WINDOW_MS,
})

/** Test seam: each case starts with a fresh window. */
export const resetAuthMailRateLimit = (): void => mailLimiter.reset()

/** Refuses once a caller has asked for too many messages in a window. Keyed
 * on the caller's address; behind a proxy that is the proxy's, which makes
 * the limit shared rather than per-visitor — stricter than intended, never
 * looser, which is the right way for a nuisance guard to be wrong. */
const takeMailAllowance = (req: Request): void => {
  if (!mailLimiter.take(req.ip ?? 'unknown')) {
    throw new HttpError(
      429,
      'too_many_requests',
      'Too many requests just now — please try again in a little while',
    )
  }
}

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
  const input = parseBody(registerSchema, req.body)
  const result = await authService.register(
    input.email,
    input.password,
    input.displayName,
    input.locale,
    appOrigin(req),
  )
  setRefreshCookie(res, result.refreshRaw)
  const body: AuthResponse = {
    user: result.user,
    accessToken: result.accessToken,
  }
  res.status(201).json(body)
})

/**
 * Confirms an address from the mailed link (AUTH-3). Open by design: someone
 * may click the link in a browser they are not signed in on, and the token
 * itself is the credential.
 */
authRouter.post('/verify-email', async (req, res) => {
  const input = parseBody(tokenSchema, req.body)
  const user = await authService.verifyEmail(input.token)
  res.json(user)
})

/** Mails a fresh verification link to the signed-in user (AUTH-3). */
authRouter.post('/verify-email/resend', requireAuth, async (req, res) => {
  takeMailAllowance(req)
  const result = await authService.resendVerification(
    req.userId!,
    appOrigin(req),
  )
  res.json(result)
})

/**
 * Starts a password reset (AUTH-4). Always 204, whether or not the address
 * has an account: any other answer would turn this into a way to find out who
 * is registered.
 */
authRouter.post('/forgot-password', async (req, res) => {
  takeMailAllowance(req)
  const input = parseBody(forgotSchema, req.body)
  await authService.requestPasswordReset(input.email, appOrigin(req))
  res.status(204).end()
})

/**
 * Finishes a reset (AUTH-4). Every session ends, including any the caller
 * holds, so they are left to sign in with the new password — which is the
 * point when the reset is someone recovering a stolen account.
 */
authRouter.post('/reset-password', async (req, res) => {
  const input = parseBody(resetSchema, req.body)
  await authService.resetPassword(input.token, input.password)
  clearRefreshCookie(res)
  res.status(204).end()
})

authRouter.post('/login', async (req, res) => {
  const input = parseBody(loginSchema, req.body)
  const result = await authService.login(input.email, input.password)
  setRefreshCookie(res, result.refreshRaw)
  const body: AuthResponse = {
    user: result.user,
    accessToken: result.accessToken,
  }
  res.json(body)
})

authRouter.post('/refresh', async (req, res) => {
  const result = await authService.refresh(req.cookies?.[REFRESH_COOKIE])
  setRefreshCookie(res, result.refreshRaw)
  const body: AuthResponse = {
    user: result.user,
    accessToken: result.accessToken,
  }
  res.json(body)
})

authRouter.post('/logout', async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE])
  clearRefreshCookie(res)
  res.status(204).end()
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await UserModel.findById(req.userId)
  if (!user)
    throw new HttpError(401, 'unauthorized', 'Account no longer exists')
  res.json(toUserDto(user))
})

// --- Google sign-in (AUTH-1), server-side Authorization Code flow ---

/**
 * The origin the app is served from, for building absolute redirect URLs.
 * One origin serves both the SPA and the API: in production the real domain,
 * in local dev the Vite dev server (:5173), which proxies /api to Express.
 * The OAuth callback and the post-login landing therefore share this origin.
 */
const requestOrigin = (req: Request): string =>
  env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`

// The state cookie proves the callback answers a request we started
// (CSRF). SameSite=Lax, not Strict: the callback arrives via Google's
// top-level cross-site redirect, which Strict would drop.
const stateCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: 10 * 60 * 1000,
} as const

/** Kicks off Google sign-in: sets a state cookie, redirects to consent. */
authRouter.get('/google/start', (req, res) => {
  if (!googleAuthConfigured()) {
    throw new HttpError(
      503,
      'google_auth_unavailable',
      'Google sign-in is not configured',
    )
  }
  const state = randomBytes(16).toString('hex')
  res.cookie(OAUTH_STATE_COOKIE, state, stateCookieOptions)
  res.redirect(buildAuthUrl(state, requestOrigin(req)))
})

/**
 * Google returns here with a code. On success the refresh cookie is set
 * and the browser is sent to the app, where the silent refresh signs the
 * user in; on any failure it lands on /login with an error code.
 */
authRouter.get('/google/callback', async (req, res) => {
  // The token exchange stays on `origin` (matches the registered redirect_uri),
  // but user-facing landings go to the SPA origin — in dev the app runs on
  // Vite (CLIENT_APP_URL), not the API port.
  const origin = requestOrigin(req)
  const landing = env.CLIENT_APP_URL ?? origin
  const fail = (code: string) => res.redirect(`${landing}/login?error=${code}`)

  const { code, state } = req.query

  // Quiz-CONNECT reuses this registered redirect URI. A connect callback
  // carries a signed-JWT state (not the sign-in cookie), so detect and hand it
  // off before the sign-in state check. verifyConnectState throws for a
  // sign-in state, so the two flows can never be confused.
  if (typeof code === 'string' && typeof state === 'string') {
    const connectState = await verifyConnectState(state).catch(() => null)
    if (connectState) {
      const back = safeReturnTo(connectState.returnTo)
      let granted = false
      try {
        granted = await storeGoogleConnect(code, connectState)
      } catch (err) {
        // Send them back regardless; the Quiz tab shows still-not-connected.
        console.warn('Google connect (via sign-in callback) failed:', err)
      }
      return res.redirect(connectReturnUrl(back, granted))
    }
  }

  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE]
  res.clearCookie(OAUTH_STATE_COOKIE, {
    ...stateCookieOptions,
    maxAge: undefined,
  })

  // Mismatched or missing state means the response is not ours to trust
  if (
    typeof code !== 'string' ||
    typeof state !== 'string' ||
    !cookieState ||
    state !== cookieState
  ) {
    console.warn('Google sign-in: state check failed', {
      hasCode: typeof code === 'string',
      hasState: typeof state === 'string',
      hasCookie: Boolean(cookieState),
      stateMatch: state === cookieState,
    })
    return fail('google_auth_failed')
  }

  try {
    const profile = await exchangeCode(code, origin)
    const result = await authService.loginWithGoogle(profile)
    setRefreshCookie(res, result.refreshRaw)
    // The SPA boots, its silent refresh reads the cookie, and the user is in
    res.redirect(`${landing}/app`)
  } catch (err) {
    console.warn('Google sign-in: exchange/login failed:', err)
    fail('google_auth_failed')
  }
})
