/**
 * The capability gate for unconfirmed accounts (AUTH-3).
 *
 * An account whose address has never been confirmed can do everything that
 * stays inside it: write lectures, edit them, export them. What it cannot do
 * is publish to everyone, or share with another person (SHARE-3) — the two
 * actions whose consequences reach past the account itself, and the ones
 * worth proving an address for.
 *
 * `mailGatedVerification` is the escape hatch for a deployment that cannot
 * send mail at all: there, confirming is impossible, so a gate would be a
 * permanent refusal rather than a step to take.
 */
import { UserModel } from '../models/user'
import { mailerAvailable } from '../lib/mailer'
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

/**
 * Refuses an unconfirmed account **where confirming is possible at all**.
 *
 * With no relay configured (MAIL_PROVIDER=none, or SMTP unset) no
 * verification link, and no password-reset link, can ever be delivered — so
 * on such a deployment `emailVerified` is reachable only through Google
 * sign-in, and gating an action on it would lock every password account out
 * of that action forever with a dialog offering a link that cannot be sent.
 *
 * Used by the share actions, whose gate exists to stop an unproven account
 * making this server send mail (SHARE-3): where there is no relay, there is
 * nothing to protect, and the deployment keeps the behaviour it had before
 * the gate. Publishing publicly is deliberately NOT gated this way — that
 * refusal is about reaching the public, which a missing relay does not
 * change.
 */
export const requireVerifiedEmailWhenMailable = async (
  userId: string,
): Promise<void> => {
  if (!mailerAvailable()) return
  await requireVerifiedEmail(userId)
}
