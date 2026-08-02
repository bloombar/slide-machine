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
 * How much of a metric's allowance is spent, as a 0–1 fraction; null when the
 * cap is unlimited. Lets a caller warn before it refuses (BILL-4) rather than
 * only at the wall.
 */
export const usedFractionOf = async (
  userId: string,
  metric: UsageMetric,
): Promise<number | null> => {
  try {
    const user = await UserModel.findById(userId).select('planTier')
    if (!user) return null
    const cap = capFor(user.planTier, metric)
    if (cap === null || cap <= 0) return null
    return (await usedThisPeriod(userId, metric)) / cap
  } catch {
    return null
  }
}

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
): Promise<boolean> => {
  try {
    const user = await UserModel.findById(userId).select('planTier')
    if (!user) return true
    const cap = capFor(user.planTier, metric)
    if (cap === null) return true
    return (await usedThisPeriod(userId, metric)) < cap
  } catch (error) {
    // A malformed id or an unreachable database must not sever a live lecture.
    // Same trade as above: an uncounted minute beats a dropped session.
    console.error(`Capacity check failed for ${userId}/${metric}:`, error)
    return true
  }
}
