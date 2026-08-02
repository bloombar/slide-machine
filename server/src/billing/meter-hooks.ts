/**
 * Ready-made `meter` hooks for action definitions (SPEC BILL-3/BILL-4).
 *
 * The hook runs before `execute`, so it answers "has this user already spent
 * their allowance?" — not "will this call exceed it?". Token counts only exist
 * after a model replies, so predicting is impossible; blocking once the
 * allowance is gone bounds the overshoot at one call, which is the trade the
 * plan settled on.
 */
import type { UsageMetric } from '@slide-machine/shared'
import type { Action } from '../actions/define'
import { UserModel } from '../models/user'
import { assertWithinCap, capFor, usedThisPeriod } from './usage'

/**
 * Builds a hook that refuses the action when `metric` is exhausted.
 *
 * Unauthenticated calls are not metered: there is no allowance to spend, and
 * the routes that matter already require auth. A user who no longer exists is
 * likewise let through — their action is about to fail on its own, and a 402
 * would be a confusing way to say "deleted account".
 */
export const requireCapacity =
  (metric: UsageMetric, message: string): NonNullable<Action['meter']> =>
  async ctx => {
    if (!ctx.userId) return
    const user = await UserModel.findById(ctx.userId).select('planTier')
    if (!user) return
    // A cap of 0 is not an exhausted allowance, it is a capability the tier
    // never had — saying "you have used all of it" would be a lie to someone
    // who never had any.
    const excluded = capFor(user.planTier, metric) === 0
    await assertWithinCap(
      ctx.userId,
      user.planTier,
      metric,
      excluded ? 'This feature is not included in your current plan.' : message,
    )
  }

/** Guards the AI token allowance — slide generation, refine, quizzes. */
export const requireAiTokens = requireCapacity(
  'aiTokens',
  'You have used all of this billing period’s AI generation. It resets at the start of your next period.',
)

/**
 * Cap check for callers outside the action pipeline. The live audio socket
 * never passes through `dispatch`, so it cannot use a `meter` hook and has to
 * ask directly — and it needs an answer rather than an exception, because a
 * WebSocket has no error response to map a 402 onto.
 *
 * Errs toward allowing: an unknown user or an unlimited cap passes, since
 * refusing to transcribe is a worse failure than an uncounted minute.
 */
export const userHasCapacity = async (
  userId: string,
  metric: UsageMetric,
  {
    /**
     * Whether a cap of `0` — "this tier does not include the capability" —
     * refuses the call.
     *
     * The live audio socket passes `false`, and the reason is a missing
     * prerequisite rather than a preference. Free and Fresh cap `sttMinutes`
     * at 0 because those tiers are meant to transcribe in the browser, where
     * it is free — but the engine is still chosen **per deployment**
     * (`TRANSCRIPTION_PROVIDER`), not per user. On a deployment configured for
     * cloud STT, enforcing the 0 would not downgrade a free user to browser
     * capture; it would stop them recording at all.
     *
     * So the socket meters their minutes and enforces only a positive
     * allowance. Once `/api/config` resolves the engine per user, a 0-cap tier
     * simply never opens this socket and this option can go.
     */
    enforceEntitlement = true,
  }: { enforceEntitlement?: boolean } = {},
): Promise<boolean> => {
  try {
    const user = await UserModel.findById(userId).select('planTier')
    if (!user) return true
    const cap = capFor(user.planTier, metric)
    if (cap === null) return true
    if (cap === 0 && !enforceEntitlement) return true
    return (await usedThisPeriod(userId, metric)) < cap
  } catch (error) {
    // A malformed id or an unreachable database must not sever a live lecture.
    // Same trade as above: an uncounted minute beats a dropped session.
    console.error(`Capacity check failed for ${userId}/${metric}:`, error)
    return true
  }
}
