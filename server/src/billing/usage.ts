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
import { Types } from 'mongoose'
import type { PlanTier, UsageMetric } from '@slide-machine/shared'
import { loadPlans } from '../config/plans'
import { UsageRecordModel } from '../models/usage-record'
import { NotificationLogModel } from '../models/notification-log'
import { SubscriptionModel } from '../models/subscription'
import { PlanLimitExceededError } from './limits'
import { noteCapCrossing } from './cap-queue'
import { recordCostEvent } from './cost-ledger'
import type { PricingHint } from './pricing'

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

/** Divisor turning a byte count into the `importMb` metric's unit. Binary
 * megabytes, matching how upload limits are expressed everywhere else here. */
export const BYTES_PER_MB = 1024 * 1024

/** The cap for a metric on a tier. `null` = unlimited. */
export const capFor = (tier: PlanTier, metric: UsageMetric): number | null =>
  planFor(tier).caps[metric]

/**
 * Metrics that measure a **stock rather than a flow** (BILL-3): what the user
 * is holding right now, not what they consumed since the period began. Storage
 * is the only one today — audio retained last month is still occupying a disk
 * this month, so a period rollover must not zero it.
 */
const GAUGE_METRICS = new Set<UsageMetric>(['audioStorageMb'])

/** Whether a metric is a standing quantity rather than a per-period total. */
export const isGaugeMetric = (metric: UsageMetric): boolean =>
  GAUGE_METRICS.has(metric)

/**
 * The period key gauges live under. A literal, never a date: period keys are
 * compared for equality and never parsed, so a word that no calendar can
 * produce is a safe way to say "this one does not roll over".
 */
export const STANDING_PERIOD = 'standing'

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
 * When the current period's counters next reset. A subscriber's follows their
 * billing period end; everyone else rolls over at the start of the next
 * calendar month in UTC, mirroring `periodKeyFor` exactly — the date shown to
 * a user and the key their usage is filed under must never disagree.
 *
 * Gauges are unaffected: nothing about them resets, which is why the views
 * label them separately rather than printing this date beside them.
 */
export const periodResetAt = async (userId: string): Promise<Date> => {
  const sub = await SubscriptionModel.findOne({ userId, status: 'active' })
  if (sub) return sub.currentPeriodEnd
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  )
}

/**
 * When the current period began — the other end of `periodResetAt`, mirroring
 * `periodKeyFor` the same way. The admin cost reports use it as the boundary
 * of "this billing period", so the window an operator reads there is the same
 * one the allowance counters are keyed to.
 */
export const periodStartFor = async (userId: string): Promise<Date> => {
  const sub = await SubscriptionModel.findOne({ userId, status: 'active' })
  if (sub) return sub.currentPeriodStart
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  )
}

/** The key a given metric's counter lives under — a gauge's never rolls over,
 * every other metric's follows the user's billing period. */
const periodForMetric = async (
  userId: string,
  metric: UsageMetric,
): Promise<string> =>
  isGaugeMetric(metric) ? STANDING_PERIOD : periodKeyFor(userId)

/**
 * Moves a gauge by `delta`, which may be negative — deleting retained audio
 * gives the space back. Clamped at zero in the same update that applies it, so
 * a decrement that arrives twice (a re-run sweep, a delete racing a purge)
 * leaves the gauge at nothing rather than owing the user storage.
 *
 * A pipeline update rather than `$inc` precisely because `$inc` cannot clamp:
 * the floor has to be applied atomically or two concurrent deletes can each
 * read a non-negative value and write a negative one.
 */
export const adjustGauge = async (
  userId: string,
  metric: UsageMetric,
  delta: number,
): Promise<void> => {
  if (!delta) return
  try {
    await UsageRecordModel.updateOne(
      { userId, period: STANDING_PERIOD, metric },
      [
        {
          $set: {
            used: {
              $max: [0, { $add: [{ $ifNull: ['$used', 0] }, delta] }],
            },
            updatedAt: new Date(),
          },
        },
      ],
      // `updatePipeline` is mongoose's opt-in for an aggregation-pipeline
      // update; without it the array is rejected as a malformed update object.
      { upsert: true, updatePipeline: true },
    )
    // Only a gauge going *up* can approach a ceiling; giving space back never
    // needs announcing.
    if (delta > 0) noteCapCrossing(userId, metric, 'check')
  } catch (error) {
    console.error(`Failed to adjust ${metric} for ${userId}:`, error)
  }
}

/**
 * Adds `quantity` to a user's counter for a metric. Never throws: a failed
 * count must not fail the work the user asked for — the same discipline the
 * audit log uses. Under-counting is a smaller problem than a 500.
 *
 * `billable: false` records the event at zero, so a cached hit still marks the
 * user as active without spending their allowance.
 *
 * Two things are written, and they are not the same thing. The counter is what
 * the cap is checked against and is keyed to a billing period. The ledger row
 * (BILL-7) is what the deployment spent and on whom, is keyed to nothing that
 * resets, and outlives the entities it describes. Both are attempted here so
 * that no metered call can update one and forget the other.
 */
export const recordUsage = async (
  userId: string,
  metric: UsageMetric,
  quantity: number,
  {
    billable = true,
    pricing,
  }: { billable?: boolean; pricing?: PricingHint } = {},
): Promise<void> => {
  if (quantity < 0) return
  try {
    const period = await periodForMetric(userId, metric)
    await UsageRecordModel.updateOne(
      { userId, period, metric },
      {
        $inc: { used: billable ? quantity : 0 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { userId, period, metric },
      },
      { upsert: true },
    )
    // The counter moved, so the account may have crossed the point where it
    // deserves a warning (BILL-8). Queued, never evaluated here: deciding
    // needs the tier, and this runs on every metered call. A cache hit moves
    // nothing and warrants nothing.
    if (billable && quantity > 0) noteCapCrossing(userId, metric, 'check')
  } catch (error) {
    console.error(`Failed to record ${metric} usage for ${userId}:`, error)
  }
  // Outside the try above: a counter that failed to move is still an event
  // that happened, and the cost of it is still real. The ledger swallows its
  // own failures, so this cannot throw either.
  await recordCostEvent({
    payerId: userId,
    metric,
    quantity,
    billable,
    pricing,
  })
}

/** How much of a metric a user has spent this period — or, for a gauge, how
 * much they are holding right now. */
export const usedThisPeriod = async (
  userId: string,
  metric: UsageMetric,
): Promise<number> => {
  const period = await periodForMetric(userId, metric)
  const record = await UsageRecordModel.findOne({ userId, period, metric })
  return record?.used ?? 0
}

/**
 * Zeroes a user's flow counters for the billing period they are in (ADMIN-10)
 * and reports what each stood at beforehand.
 *
 * Only the current period is touched. Past periods are the record of what the
 * account actually consumed — the all-time view and the cost reports read them
 * — and rewriting history would make a reset indistinguishable from usage that
 * never happened. Gauges are untouched for the same reason `periodKeyFor` never
 * returns their key: `audioStorageMb` measures audio the account is holding
 * this instant, and no reset makes a stored file stop occupying a disk.
 *
 * Counters are set to zero rather than deleted so a concurrent `$inc` upsert
 * cannot race the reset into a duplicate row on the unique index; the rows are
 * the counters, and the reset moves them like anything else does.
 *
 * Any cap notification already claimed for the period is released alongside
 * (BILL-8). The claim row means "this account has been told about this metric
 * this period", which stops being true the moment the allowance behind it is
 * given back — leaving it would let an account spend a restored allowance all
 * the way to the cap and be refused without ever being warned. Gauges keep
 * their claims: their counters were not reset, so nothing about what they were
 * told has changed.
 */
export const resetPeriodUsage = async (
  userId: string,
): Promise<{ period: string; cleared: Record<string, number> }> => {
  const period = await periodKeyFor(userId)
  const rows = await UsageRecordModel.find({ userId, period })
  const cleared = Object.fromEntries(
    rows.filter(row => row.used > 0).map(row => [row.metric, row.used]),
  )
  await UsageRecordModel.updateMany(
    { userId, period },
    { $set: { used: 0, updatedAt: new Date() } },
  )
  await NotificationLogModel.deleteMany({
    userId,
    period,
    metric: { $nin: [...GAUGE_METRICS] },
  })
  return { period, cleared }
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
  if (used >= cap) {
    // The refusal *is* the "reached" moment (BILL-8): a cap that blocks
    // something is the point at which the payer has to be told, and it is the
    // one place that knows work was actually turned away rather than merely
    // that a counter is high. Queued, not sent — nobody waits on mail to be
    // refused, and a viewer who triggered this is not the one notified.
    noteCapCrossing(userId, metric, 'reached')
    throw new PlanLimitExceededError(metric, cap, used, message)
  }
}

/**
 * Every metric's usage and cap for one user — the shape the account and admin
 * views read (BILL-3's "the user can view remaining quota").
 *
 * `period` names the billing period the flow metrics belong to. Gauges are
 * folded in from their standing counter and are deliberately not labelled with
 * it: "500 MB held" is not a fact about this month, and a view that presents it
 * beside "resets on the 17th" would be telling the user something untrue.
 */
export const usageSummary = async (
  userId: string,
  tier: PlanTier,
): Promise<{
  period: string
  metrics: Record<string, { used: number; cap: number | null }>
}> => {
  const period = await periodKeyFor(userId)
  const records = await UsageRecordModel.find({
    userId,
    period: { $in: [period, STANDING_PERIOD] },
  })
  // A gauge's row only ever exists under the standing key, and a flow's only
  // ever under the period key, so one map cannot collide.
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

/**
 * Like `usageSummary`, but totalled over every period the account has ever
 * had — the admin console's "all time" view. Gauges only ever have their one
 * standing row, so for them "all time" and "right now" are the same fact.
 *
 * Still a count of what was *spent*: cache hits were recorded at zero, so a
 * lifetime total here answers "what did this account consume", not "how often
 * did services run" — that second question is the cost ledger's (BILL-7).
 */
export const usageSummaryAllTime = async (
  userId: string,
  tier: PlanTier,
): Promise<Record<string, { used: number; cap: number | null }>> => {
  const rows = await UsageRecordModel.aggregate<{ _id: string; used: number }>([
    // An aggregation does no schema casting, so the id must be an ObjectId
    // here — a string would match nothing and read as "never used anything".
    { $match: { userId: new Types.ObjectId(userId) } },
    { $group: { _id: '$metric', used: { $sum: '$used' } } },
  ])
  const used = new Map(rows.map(r => [r._id, r.used]))
  const caps = planFor(tier).caps
  return Object.fromEntries(
    (Object.keys(caps) as UsageMetric[]).map(metric => [
      metric,
      { used: used.get(metric) ?? 0, cap: caps[metric] },
    ]),
  )
}
