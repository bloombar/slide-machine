/**
 * Metered usage for one user, metric, and billing period (SPEC BILL-3).
 * One document per (userId, period, metric), incremented in place — the
 * counter the cap is checked against.
 *
 * Deliberately *not* an event log: the per-event ledger that answers "what did
 * this lecture cost" is BILL-7's concern. This collection answers only "how
 * much of their allowance has this user spent", which has to be cheap to read
 * on every metered call.
 */
import { Schema, type HydratedDocument, type Types } from 'mongoose'
import type { UsageMetric, UsageRecord } from '@slide-machine/shared'
import { defineModel } from './define-model'

export interface UsageRecordDb {
  userId: Types.ObjectId
  /** Opaque period key: 'YYYY-MM' for calendar months, or the subscription's
   * period start when the user has one. Compared for equality, never parsed. */
  period: string
  metric: UsageMetric
  used: number
  updatedAt: Date
}

const usageRecordSchema = new Schema<UsageRecordDb>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  period: { type: String, required: true },
  metric: { type: String, required: true },
  used: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now },
})

// One counter per user/period/metric. Unique so concurrent increments race on
// the index rather than silently creating parallel counters that each stay
// under the cap.
usageRecordSchema.index({ userId: 1, period: 1, metric: 1 }, { unique: true })

// Reachable from the action graph, which some specs re-evaluate — see
// define-model.ts for why that needs the registry-aware helper.
export const UsageRecordModel = defineModel<UsageRecordDb>(
  'UsageRecord',
  usageRecordSchema,
)

/** Maps a usage document to the wire shape; `cap` comes from the plan, not
 * the record, so the caller supplies it. */
export const toUsageRecordDto = (
  doc: HydratedDocument<UsageRecordDb>,
  cap: number | null,
): UsageRecord => ({
  id: doc._id.toString(),
  userId: doc.userId.toString(),
  period: doc.period,
  metric: doc.metric,
  used: doc.used,
  cap,
})
