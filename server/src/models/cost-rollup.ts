/**
 * Monthly pre-aggregated cost, kept behind the raw ledger (SPEC BILL-7/P-11).
 *
 * The ledger is the one collection in the product that grows with **usage**
 * rather than with content: a busy deployment writes a row per model call, per
 * playback, per translation, forever. Reports that scan all of it stop being
 * cheap long before anyone notices, and by then the fix is a migration.
 *
 * So raw events are kept for a bounded window and rolled up monthly behind it.
 * A roll-up keeps exactly what the reports read — money split by who caused it,
 * and per-metric quantities — and drops what only an investigation would want:
 * individual timestamps, and which student did what. That the detail is
 * *unrecoverable* after the window is a feature rather than a cost: BILL-7's
 * views are averages and totals, and §16 has no interest in remembering that a
 * particular student played a particular slide two years ago.
 *
 * The grain is (month, payer, project, lecture) — the three scopes reports roll
 * up by, so an aged month can still answer them without the rows behind it.
 */
import { Schema, type Types } from 'mongoose'
import type { UsageMetric } from '@slide-machine/shared'
import { defineModel } from './define-model'

/** One metric's contribution to a rolled-up month. */
export interface RolledMetric {
  metric: UsageMetric
  quantity: number
  costMicros: number
  events: number
  cachedEvents: number
}

export interface CostRollupDb {
  /** Calendar month in UTC, `YYYY-MM`. Compared, never parsed. */
  month: string
  payerId: Types.ObjectId
  projectId?: Types.ObjectId | null
  deckId?: Types.ObjectId | null
  /** Names as they were, for the same reason the ledger denormalizes them. */
  projectName?: string
  deckName?: string
  instructorMicros: number
  audienceMicros: number
  systemMicros: number
  byMetric: RolledMetric[]
  /**
   * How many registered students appeared in the month, at this grain.
   *
   * A count rather than the set: keeping the ids would defeat the point of
   * aging the raw rows out. The cost is that two months cannot be summed
   * without double-counting a student present in both, which is why the
   * reports treat this as a per-month figure and say so.
   */
  registeredStudents: number
  anonymousEvents: number
  /** When this roll-up was written, so a re-run can be told from a first run. */
  rolledAt: Date
}

const rolledMetricSchema = new Schema<RolledMetric>(
  {
    metric: { type: String, required: true },
    quantity: { type: Number, required: true, default: 0 },
    costMicros: { type: Number, required: true, default: 0 },
    events: { type: Number, required: true, default: 0 },
    cachedEvents: { type: Number, required: true, default: 0 },
  },
  { _id: false },
)

const costRollupSchema = new Schema<CostRollupDb>({
  month: { type: String, required: true },
  payerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  deckId: { type: Schema.Types.ObjectId, ref: 'Deck', default: null },
  projectName: String,
  deckName: String,
  instructorMicros: { type: Number, required: true, default: 0 },
  audienceMicros: { type: Number, required: true, default: 0 },
  systemMicros: { type: Number, required: true, default: 0 },
  byMetric: { type: [rolledMetricSchema], default: [] },
  registeredStudents: { type: Number, required: true, default: 0 },
  anonymousEvents: { type: Number, required: true, default: 0 },
  rolledAt: { type: Date, required: true, default: Date.now },
})

// The grain, and the idempotency key: a sweep that runs twice replaces the
// month's row rather than doubling it.
costRollupSchema.index(
  { month: 1, payerId: 1, projectId: 1, deckId: 1 },
  { unique: true },
)
costRollupSchema.index({ month: -1 })

export const CostRollupModel = defineModel<CostRollupDb>(
  'CostRollup',
  costRollupSchema,
)
