/**
 * Auth routes (SPEC AUTH-1/AUTH-2). The refresh token travels only in an
 * httpOnly SameSite=Strict cookie scoped to /api/auth; access tokens are
 * returned in the body and held in client memory.
 */
import { randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { AuthResponse } from '@slide-machine/shared'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import { requireAuth } from '../middleware/auth'
import * as authService from '../auth/service'
import {
  buildAuthUrl,
  exchangeCode,
  googleAuthConfigured,
} from '../auth/google'
import { UserModel, toUserDto } from '../models/user'

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
})

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
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

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
  const input = parseBody(registerSchema, req.body)
  const result = await authService.register(
    input.email,
    input.password,
    input.displayName,
  )
  setRefreshCookie(res, result.refreshRaw)
  const body: AuthResponse = {
    user: result.user,
    accessToken: result.accessToken,
  }
  res.status(201).json(body)
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
