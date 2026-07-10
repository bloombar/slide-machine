/**
 * Bearer-token authentication middleware (SPEC AUTH-2 / P-4). Attaches
 * the verified userId to the request; protected routes compose this and
 * can rely on req.userId being present.
 */
import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../auth/tokens'
import { HttpError } from './error'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'unauthorized', 'Sign in to continue')
  }
  try {
    const { userId } = await verifyAccessToken(header.slice('Bearer '.length))
    req.userId = userId
  } catch {
    throw new HttpError(
      401,
      'invalid_token',
      'Session token is invalid or expired',
    )
  }
  next()
}
