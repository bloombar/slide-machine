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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The acting admin, set by requireAdmin. Handlers pass it to
       * logAdminAction without re-querying the user. */
      adminUser?: { id: string; email: string }
    }
  }
}

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
  req.adminUser = { id: user._id.toString(), email: user.email }
  next()
}
