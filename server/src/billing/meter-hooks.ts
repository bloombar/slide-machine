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
import { assertWithinCap } from './usage'

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
    await assertWithinCap(ctx.userId, user.planTier, metric, message)
  }

/** Guards the AI token allowance — slide generation, refine, quizzes. */
export const requireAiTokens = requireCapacity(
  'aiTokens',
  'You have used all of this billing period’s AI generation. It resets at the start of your next period.',
)
