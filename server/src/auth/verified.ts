/**
 * The capability gate for unconfirmed accounts (AUTH-3).
 *
 * An account whose address has never been confirmed can do everything private:
 * write lectures, share them with named people, export them. What it cannot do
 * is publish to everyone — the one action whose consequences reach past the
 * account itself, and the one worth proving an address for.
 */
import { UserModel } from '../models/user'
import { EmailUnverifiedError } from '../actions/dispatch'

/** Whether this account has confirmed its address. */
export const emailVerified = async (userId: string): Promise<boolean> => {
  const user = await UserModel.findById(userId, { emailVerified: 1 }).catch(
    () => null,
  )
  return Boolean(user?.emailVerified)
}

/** Refuses unless the account has confirmed its address. */
export const requireVerifiedEmail = async (userId: string): Promise<void> => {
  if (!(await emailVerified(userId))) throw new EmailUnverifiedError()
}
