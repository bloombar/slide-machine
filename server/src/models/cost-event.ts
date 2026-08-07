/**
 * The append-only cost ledger (SPEC BILL-7).
 *
 * One row per metered event, answering "what did this lecture cost, and who
 * was it spent on" — a question `UsageRecord` deliberately cannot answer,
 * because that collection is a counter the cap is checked against on every
 * paid call and has to stay cheap to read.
 *
 * Four decisions make the rows worth keeping:
 *
 * 1. **Both the payer and the actor are recorded.** The deck's owner always
 *    pays for audience activity (BILL-3), so a ledger keyed only to the payer
 *    could not separate "what this instructor spent" from "what their students
 *    caused" — and those have different remedies, one a plan-sizing question
 *    and the other an audience-reach one.
 * 2. **Both the project and the lecture are recorded, at the time.** A
 *    lecture's owner is not always its project's owner, so neither reference
 *    can be inferred later from the other.
 * 3. **Names are denormalized onto the row.** Ledger rows are never
 *    cascade-deleted with the entities they describe — a deleted lecture's
 *    cost still happened — so the row has to be able to name what it was for
 *    after that thing is gone.
 * 4. **Cost is frozen at write.** Priced from the configured service prices
 *    (BILL-6) when the event occurs, never recomputed. A vendor changing its
 *    rates must not retroactively rewrite what last month cost.
 *
 * Cache hits are recorded too, at zero. That is what makes the denominators
 * honest: a deck where two students trigger a translation and twenty-eight
 * read the stored result cost what those two spent, but it reached **thirty**
 * students, and an average over two would be an order of magnitude wrong.
 */
import { Schema, type Types } from 'mongoose'
import type { UsageMetric } from '@slide-machine/shared'
import { defineModel } from './define-model'

/** How the person who caused an event related to the deck it belonged to. */
export const COST_ACTOR_KINDS = ['owner', 'audience', 'system'] as const

export type CostActorKind = (typeof COST_ACTOR_KINDS)[number]

export interface CostEventDb {
  /** The account charged — the deck's owner for audience work (BILL-3). */
  payerId: Types.ObjectId
  /**
   * Who caused it. Absent for an anonymous viewer: unregistered playbacks are
   * reported as an event count, and assigning them tracking identities to make
   * them countable would conflict with §16.
   */
  actorId?: Types.ObjectId | null
  /** Whether the payer caused this themselves, a viewer did, or the system
   * did on nobody's behalf. The instructor-versus-student split reads this. */
  actorKind: CostActorKind
  projectId?: Types.ObjectId | null
  /** The project's title when the event happened; the row outlives it. */
  projectName?: string
  deckId?: Types.ObjectId | null
  /** The lecture's title when the event happened; the row outlives it. */
  deckName?: string
  metric: UsageMetric
  /** In the metric's own unit — tokens, minutes, characters. */
  quantity: number
  /**
   * Whether this spent an allowance. `false` is a cache hit: it happened, it
   * reached someone, and it cost nothing.
   */
  billable: boolean
  /** Millionths of a currency unit, frozen at write time (BILL-6). */
  costMicros: number
  /** The currency that figure is in, recorded so a deployment that changes it
   * cannot silently reinterpret older rows. */
  currency: string
  occurredAt: Date
}

const costEventSchema = new Schema<CostEventDb>({
  payerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorKind: { type: String, enum: COST_ACTOR_KINDS, required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  projectName: String,
  deckId: { type: Schema.Types.ObjectId, ref: 'Deck', default: null },
  deckName: String,
  metric: { type: String, required: true },
  quantity: { type: Number, required: true },
  billable: { type: Boolean, required: true, default: true },
  costMicros: { type: Number, required: true, default: 0 },
  currency: { type: String, required: true },
  occurredAt: { type: Date, required: true, default: Date.now },
})

// The three roll-ups BILL-7 reports, each time-bounded: per user, per lecture,
// per project. Compound with `occurredAt` because every view is "this entity,
// over this window", and a scan of one entity's whole history to answer a
// question about last month is the thing that stops being cheap first.
costEventSchema.index({ payerId: 1, occurredAt: -1 })
costEventSchema.index({ deckId: 1, occurredAt: -1 })
costEventSchema.index({ projectId: 1, occurredAt: -1 })
// Deployment-wide totals and the retention sweep both walk by time alone.
costEventSchema.index({ occurredAt: -1 })

// Deliberately no soft-delete plugin: a deleted lecture's cost still happened,
// and a ledger that disappears with the thing it describes cannot answer what
// the deployment spent. The retention window (P-11) is what bounds it instead.
export const CostEventModel = defineModel<CostEventDb>(
  'CostEvent',
  costEventSchema,
)
