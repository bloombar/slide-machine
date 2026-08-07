/**
 * Requirements an action adds on top of its resource check (SPEC TECH-14).
 *
 * These are not access-control questions — the caller's rights to the thing
 * are already settled by the time one runs. They ask whether the *account* is
 * equipped for the operation: has it connected a Google account, has it
 * confirmed its address. Both are things the user can fix themselves, which
 * is why each has an error of its own rather than a flat refusal.
 *
 * They compose, so the resource check always runs first. That ordering is the
 * point: someone with no rights to a lecture should be told so, not invited
 * to connect an account they were never going to be allowed to use.
 */
import { UserModel } from '../../models/user'
import { isLive } from '../export'
import { requireVerifiedEmail } from '../../auth/verified'
import { CapabilityRequiredError } from '../dispatch'
import { definePolicy, type AccessPolicy } from './policy'
import type { WithGoogle } from './types'

/**
 * Whether the account can reach Google Drive. In live mode this needs a
 * stored refresh token — the mock-mode `googleConnected` flag must NOT count
 * once switched to live, or publishing fails with no real grant behind it.
 */
export const isConnected = (user: {
  googleConnected?: boolean
  googleQuizRefreshToken?: string
}): boolean =>
  isLive()
    ? Boolean(user.googleQuizRefreshToken)
    : Boolean(user.googleConnected)

/** The acting account with its encrypted Google token, or a refusal. */
const loadGoogleUser = async (userId: string) => {
  const user = await UserModel.findById(userId).select(
    '+googleQuizRefreshToken',
  )
  // The route guarantees a token, so a missing account means it was deleted
  // after the token was issued.
  if (!user) throw new CapabilityRequiredError('google-drive')
  return user
}

/**
 * Loads the acting account alongside `policy`'s result WITHOUT requiring a
 * connection — for actions that report whether one exists (quiz.status,
 * export.status) rather than needing one.
 */
export const withGoogleAccount = <I, R>(
  policy: AccessPolicy<I, R & { userId: string }>,
): AccessPolicy<I, WithGoogle<R & { userId: string }>> =>
  definePolicy(policy.descriptor, async (ctx, input) => {
    const access = await policy.authorize(ctx, input)
    return { ...access, googleUser: await loadGoogleUser(access.userId) }
  })

/**
 * Requires a connected Google account on top of `policy`.
 *
 * Refused as a missing capability, not a forbidden resource: the two were
 * indistinguishable before — same class, same status, different message text
 * — so a client could not tell "not your lecture" from "connect an account"
 * without reading the prose.
 */
export const requiresGoogleDrive = <I, R>(
  policy: AccessPolicy<I, R & { userId: string }>,
): AccessPolicy<I, WithGoogle<R & { userId: string }>> =>
  definePolicy(
    { ...policy.descriptor, capabilities: ['google-drive'] },
    async (ctx, input) => {
      const access = await policy.authorize(ctx, input)
      const googleUser = await loadGoogleUser(access.userId)
      if (!isConnected(googleUser)) {
        throw new CapabilityRequiredError('google-drive')
      }
      return { ...access, googleUser }
    },
  )

/**
 * Applies a further gate after the resource check, when `when` says it
 * applies. Used for publishing, which needs a confirmed address (AUTH-3) only
 * when the visibility being set is public.
 */
export const alsoRequires = <I, R>(
  policy: AccessPolicy<I, R>,
  capability: 'verified-email',
  gate: (ctx: { userId: string }, input: I, access: R) => Promise<void>,
): AccessPolicy<I, R> =>
  definePolicy(
    {
      ...policy.descriptor,
      capabilities: [...(policy.descriptor.capabilities ?? []), capability],
    },
    async (ctx, input) => {
      const access = await policy.authorize(ctx, input)
      await gate({ userId: ctx.userId! }, input, access)
      return access
    },
  )

/** Confirmed-address gate for the publishing actions (AUTH-3). */
export const verifiedEmailWhenPublic = async (
  ctx: { userId: string },
  input: { visibility?: string },
): Promise<void> => {
  if (input.visibility === 'public') await requireVerifiedEmail(ctx.userId)
}
