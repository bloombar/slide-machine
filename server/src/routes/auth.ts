/**
 * Auth routes (SPEC AUTH-1/AUTH-2). The refresh token travels only in an
 * httpOnly SameSite=Strict cookie scoped to /api/auth; access tokens are
 * returned in the body and held in client memory.
 */
import { Router, type Response } from 'express'
import { z } from 'zod'
import type { AuthResponse } from '@slide-machine/shared'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import { requireAuth } from '../middleware/auth'
import * as authService from '../auth/service'
import { UserModel, toUserDto } from '../models/user'

export const REFRESH_COOKIE = 'sm_refresh'

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
