/**
 * Openings of a lecture (SPEC EVAL-7).
 *
 * One row per time somebody opened a lecture in the viewer, whether or not
 * they were signed in. It is the denominator the other post-lecture measures
 * were missing: narration and translated reading are recorded, but a lecture
 * nobody opened and a lecture thirty people read and never translated look
 * identical without this.
 *
 * Five decisions shape it:
 *
 * 1. **It is not a cost event.** Opening a lecture spends nothing, and
 *    `UsageMetric` is `keyof PlanCaps` — putting views there would create an
 *    allowance that could refuse to open a lecture. Views live in their own
 *    collection precisely so no billing decision can ever depend on them.
 * 2. **Anonymous viewers are counted, never identified.** `viewerId` is null
 *    for a signed-out reader and nothing stands in for it — no cookie, no
 *    fingerprint, no visit token. BILL-7 and §16 rule that out explicitly, so
 *    what this answers for signed-out readers is "how many openings", not
 *    "how many people". Signed-in readers are named, and in the pilot most
 *    students sign in for exit tickets anyway.
 * 3. **Names are denormalized, like the cost ledger's.** Rows are not
 *    cascade-deleted with the lecture they describe — a deleted lecture was
 *    still read — so the row has to be able to name what it was for
 *    afterwards.
 * 4. **No language here.** A reader's chosen locale is not settled when the
 *    lecture opens, so a language on this row would say "the one it was
 *    written in" for someone who switched a second later. The metered
 *    translation event carries the language honestly (SHARE-2) and is the
 *    place to ask.
 * 5. **One row per opening, not per request.** The viewer re-fetches the deck
 *    to poll for new audio and after a settings change; those are not
 *    readings. The client asks for a view to be recorded once, when it opens
 *    the lecture, rather than the route counting every GET it serves.
 */
import { Schema, type Types } from 'mongoose'
import { ACTOR_CHANNELS, type ActorChannel } from '@slide-machine/shared'
import { defineModel } from './define-model'

/** How the person who opened the lecture related to it. No `system` case: a
 * sweep does not read a lecture, so unlike the cost ledger there is nothing
 * here that happened on nobody's behalf. */
export const DECK_VIEW_ACTOR_KINDS = ['owner', 'audience'] as const

export type DeckViewActorKind = (typeof DECK_VIEW_ACTOR_KINDS)[number]

export interface DeckViewDb {
  deckId: Types.ObjectId
  /** The lecture's title when it was opened; the row outlives it. */
  deckName?: string
  projectId?: Types.ObjectId | null
  /** The project's title at the time, for the same reason. */
  projectName?: string
  /** The lecture's owner — who the per-instructor roll-up belongs to. Kept
   * even though it is reachable through `deckId`, because the row has to stay
   * meaningful after the lecture is purged. */
  ownerId: Types.ObjectId
  /**
   * Who opened it, when they are identifiable. Null for a signed-out reader,
   * and deliberately not replaced with a tracking identity to make them
   * countable — that trade is what §16 refuses. Those are counted as
   * openings instead.
   */
  viewerId?: Types.ObjectId | null
  /** Whether the lecture's own owner opened it or somebody else did. The
   * instructor-versus-student split reads this, and it is what keeps an
   * author previewing their own lecture out of the audience numbers. */
  actorKind: DeckViewActorKind
  /** How the request arrived — the app, or an assistant over MCP. Same
   * distinction the cost ledger draws, for the same reason. */
  channel: ActorChannel
  occurredAt: Date
}

const deckViewSchema = new Schema<DeckViewDb>({
  deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
  deckName: String,
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  projectName: String,
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  viewerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorKind: { type: String, enum: DECK_VIEW_ACTOR_KINDS, required: true },
  channel: {
    type: String,
    enum: ACTOR_CHANNELS,
    required: true,
    default: 'app',
  },
  occurredAt: { type: Date, required: true, default: Date.now },
})

// "How often was this lecture opened, over this window" — the question the
// collection exists for, and the one the research export runs.
deckViewSchema.index({ deckId: 1, occurredAt: -1 })
// The same question per instructor, which cannot be answered by walking the
// lectures because a purged one takes its rows' only link with it.
deckViewSchema.index({ ownerId: 1, occurredAt: -1 })
// The retention sweep and any deployment-wide total walk by time alone.
deckViewSchema.index({ occurredAt: -1 })

// Deliberately no soft-delete plugin, matching the cost ledger: a deleted
// lecture was still read, and a record that disappears with the thing it
// describes cannot answer what the deployment reached. The retention window
// bounds it instead.
export const DeckViewModel = defineModel<DeckViewDb>('DeckView', deckViewSchema)
