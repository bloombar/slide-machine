/**
 * Record of a cap notification already sent (SPEC §15, BILL-8).
 *
 * One row per (user, metric, period, threshold) — and the row is not a log of
 * what happened, it is the **lock that decides whether it happens**. A blocked
 * translation in a class of thirty produces thirty refusals within a second of
 * each other, every one of them a legitimate reason to notify the owner; the
 * unique index is what turns those thirty into one email.
 *
 * Writing before sending, rather than after, is the whole trick. Two requests
 * racing both try to insert; exactly one succeeds, and only that one sends. An
 * insert-after-send would leave a window wide enough for the class to fit
 * through, which is precisely the case this exists for.
 *
 * The cost of being wrong in this direction is a notification silently lost if
 * the send then fails, which BILL-8 accepts: mail failures are logged, never
 * raised, and the in-app notice is not gated on any of this — it is derived
 * from the counters and appears regardless.
 *
 * Rows are keyed by billing period, so they age out of relevance on their own:
 * the next period's crossing is a different key and notifies afresh.
 */
import { Schema, type Types } from 'mongoose'
import type { UsageMetric } from '@slide-machine/shared'
import type { NotificationThreshold } from '../billing/cap-queue'
import { defineModel } from './define-model'

/** Which of BILL-8's two moments a row records. */
export const NOTIFICATION_THRESHOLDS = [
  'approaching',
  'reached',
] as const satisfies readonly NotificationThreshold[]

export interface NotificationLogDb {
  userId: Types.ObjectId
  metric: UsageMetric
  /**
   * The billing period the crossing belongs to, in the same opaque form the
   * usage counters use. Gauges are the one wrinkle: `audioStorageMb` has no
   * period of its own (BILL-3), but a notification about it does — an account
   * still over its storage next month should hear about it again rather than
   * be told once, forever. So gauges are filed under the reader's *billing*
   * period even though the counter behind them is not.
   */
  period: string
  threshold: NotificationThreshold
  sentAt: Date
}

const notificationLogSchema = new Schema<NotificationLogDb>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  metric: { type: String, required: true },
  period: { type: String, required: true },
  threshold: {
    type: String,
    enum: NOTIFICATION_THRESHOLDS,
    required: true,
  },
  sentAt: { type: Date, default: Date.now },
})

// The lock. Unique so concurrent crossings race on the index rather than each
// deciding, correctly and separately, that nobody has been told yet.
notificationLogSchema.index(
  { userId: 1, metric: 1, period: 1, threshold: 1 },
  { unique: true },
)

export const NotificationLogModel = defineModel<NotificationLogDb>(
  'NotificationLog',
  notificationLogSchema,
)

/**
 * Claims the right to notify about one crossing, returning whether this caller
 * is the one that won.
 *
 * `false` means somebody already has it — a concurrent request, or this same
 * crossing earlier in the period. Never throws: a notification is not worth
 * failing a user's request over, and a claim that errors is treated as lost,
 * which errs towards saying nothing rather than towards saying it thirty times.
 */
export const claimNotification = async (
  userId: string,
  metric: UsageMetric,
  period: string,
  threshold: NotificationThreshold,
): Promise<boolean> => {
  try {
    await NotificationLogModel.create({
      userId,
      metric,
      period,
      threshold,
      sentAt: new Date(),
    })
    return true
  } catch {
    // Duplicate key (already claimed) or a database problem. Both mean "do not
    // send", and neither is distinguishable enough to be worth acting on
    // differently.
    return false
  }
}
