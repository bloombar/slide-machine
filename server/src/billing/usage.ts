/**
 * Usage metering (SPEC BILL-3): counts what each user spends against their
 * plan's caps, and refuses work once a cap is exhausted (BILL-4).
 *
 * Two rules shape the design:
 *
 * 1. **Block when already over, not when this call might exceed.** Real token
 *    counts only arrive *after* a model call, so a check beforehand can only
 *    ask "has this user already spent their allowance". One call of overshoot
 *    is tolerated; unbounded overshoot is not.
 * 2. **Cache hits are recorded but never debited.** Serving something already
 *    generated costs nothing, so it must not consume an allowance — while
 *    still being counted, because the number of users and students is what
 *    every average is divided by (BILL-7).
 */
import type { PlanTier, UsageMetric } from '@slide-machine/shared'
import { loadPlans } from '../config/plans'
import { UsageRecordModel } from '../models/usage-record'
import { SubscriptionModel } from '../models/subscription'
import { PlanLimitExceededError } from './limits'

/** Plans are read once: the file is deploy-time configuration, not per-request
 * state, and every metered call would otherwise re-read it from disk. */
let plans: ReturnType<typeof loadPlans> | undefined
const planFor = (tier: PlanTier) => {
  plans ??= loadPlans()
  return plans[tier] ?? plans.free
}

/** Test seam: drops the cached plans so a spec can point at another file. */
export const resetPlanCache = (): void => {
  plans = undefined
}

/** The cap for a metric on a tier. `null` = unlimited. */
export const capFor = (tier: PlanTier, metric: UsageMetric): number | null =>
  planFor(tier).caps[metric]

/**
 * The period a user's usage counts against. A subscriber's allowance resets
 * with their billing period, so their counter is keyed to it; everyone else
 * (the free tier has no subscription at all) resets on the calendar month in
 * UTC, which is stable regardless of where the user is.
 */
export const periodKeyFor = async (userId: string): Promise<string> => {
  const sub = await SubscriptionModel.findOne({ userId, status: 'active' })
  if (sub) return sub.currentPeriodStart.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

/**
 * Adds `quantity` to a user's counter for a metric. Never throws: a failed
 * count must not fail the work the user asked for — the same discipline the
 * audit log uses. Under-counting is a smaller problem than a 500.
 *
 * `billable: false` records the event at zero, so a cached hit still marks the
 * user as active without spending their allowance.
 */
export const recordUsage = async (
  userId: string,
  metric: UsageMetric,
  quantity: number,
  { billable = true }: { billable?: boolean } = {},
): Promise<void> => {
  if (quantity < 0) return
  try {
    const period = await periodKeyFor(userId)
    await UsageRecordModel.updateOne(
      { userId, period, metric },
      {
        $inc: { used: billable ? quantity : 0 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { userId, period, metric },
      },
      { upsert: true },
    )
  } catch (error) {
    console.error(`Failed to record ${metric} usage for ${userId}:`, error)
  }
}

/** How much of a metric a user has spent this period. */
export const usedThisPeriod = async (
  userId: string,
  metric: UsageMetric,
): Promise<number> => {
  const period = await periodKeyFor(userId)
  const record = await UsageRecordModel.findOne({ userId, period, metric })
  return record?.used ?? 0
}

/**
 * Refuses the call when the user has already spent this metric's allowance.
 * A cap of `null` is unlimited and always passes; a cap of `0` means the tier
 * does not offer the capability at all, which fails on the first attempt.
 */
export const assertWithinCap = async (
  userId: string,
  tier: PlanTier,
  metric: UsageMetric,
  message?: string,
): Promise<void> => {
  const cap = capFor(tier, metric)
  if (cap === null) return
  const used = await usedThisPeriod(userId, metric)
  if (used >= cap) throw new PlanLimitExceededError(metric, cap, used, message)
}

/** Every metric's usage and cap for one user — the shape the account and admin
 * views read (BILL-3's "the user can view remaining quota"). */
export const usageSummary = async (
  userId: string,
  tier: PlanTier,
): Promise<{
  period: string
  metrics: Record<string, { used: number; cap: number | null }>
}> => {
  const period = await periodKeyFor(userId)
  const records = await UsageRecordModel.find({ userId, period })
  const used = new Map(records.map(r => [r.metric, r.used]))
  const caps = planFor(tier).caps
  const metrics = Object.fromEntries(
    (Object.keys(caps) as UsageMetric[]).map(metric => [
      metric,
      { used: used.get(metric) ?? 0, cap: caps[metric] },
    ]),
  )
  return { period, metrics }
}
