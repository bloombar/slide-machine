/**
 * Admin authorization middleware. Composes after requireAuth: resolves
 * req.userId to an account and rejects with 403 unless its email is on
 * the ADMIN_EMAILS allowlist. Client-side gating is cosmetic — this is
 * the security boundary for every /api/admin route.
 */
import type { NextFunction, Request, Response } from 'express'
import { UserModel } from '../models/user'
import { isAdminEmail } from '../config/admin'
import { HttpError } from './error'

export const requireAdmin = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.userId) {
    throw new HttpError(401, 'unauthorized', 'Sign in to continue')
  }
  const user = await UserModel.findById(req.userId)
  if (!user || !isAdminEmail(user.email)) {
    throw new HttpError(403, 'forbidden', 'Admin access required')
  }
  next()
}
