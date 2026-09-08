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
 * 6. **Depth completes the opening; it never identifies it further.**
 *    `slidesReached` and `activeMs` answer "how far" and "how long", but
 *    reaching them the same way `viewerId` is reached — by asking who the
 *    reader is — would undo decision 2 for the very readers it protects. So
 *    the view route hands back a `completionKey` naming *this row*, and the
 *    completion route trades that key for an update: it identifies an
 *    opening, never a person.
 * 7. **The key is reusable for one reading, and monotonicity is what makes
 *    that safe.** A reader sends several reports over one opening — the tab
 *    going to the background, a periodic flush, the page unloading — and the
 *    *last* one is the accurate one, because depth only grows as they read.
 *    So the key is not spent on first use. It cannot be: a key retired by
 *    the first report would freeze every row at whatever the first flush
 *    happened to see (30 seconds in), and the column would measure the
 *    reporting timer rather than the reading. Replay is instead made
 *    harmless by `$max` — a report can only ever raise a stored value, never
 *    lower it — so re-sending one changes nothing, and arriving out of order
 *    changes nothing either. What bounds the key is time, not use:
 *    `completionKeyExpiresAt` stops it working once no honest reading could
 *    still be in progress, and until then the worst a stolen or guessed key
 *    achieves is raising one anonymous row towards a ceiling
 *    (`slidesReached` to the deck's slide count, `activeMs` to a day) that
 *    the route validates against anyway.
 * 8. **Both numbers are a floor.** A reader who closes the tab mid-lecture
 *    reports nothing further, so what is stored is "reached at least this
 *    far", never "reached exactly this far and no further".
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
  /** The furthest slide index reached, plus one — a floor, not an exact
   * count: a reader who closes the tab mid-lecture reports nothing further.
   * Only ever moves up (decision 8). Null until the first depth report. */
  slidesReached?: number | null
  /** Milliseconds this opening was actually visible on screen — accrues only
   * while the tab was in the foreground, so a lecture left open overnight
   * does not read as a long one. Also a floor, and only ever moves up. */
  activeMs?: number | null
  /** This opening's credential for reporting depth (decision 6). Set when the
   * row is created and good for as many reports as the reading sends, since
   * only the last one is accurate; null on rows that never got one. */
  completionKey?: string | null
  /** When `completionKey` stops being accepted (decision 7). Time, not use,
   * is what retires it — a key spent on first use would freeze the row at
   * whatever the first flush saw. Null on rows with no key. */
  completionKeyExpiresAt?: Date | null
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
  slidesReached: { type: Number, default: null },
  activeMs: { type: Number, default: null },
  completionKey: { type: String, default: null },
  completionKeyExpiresAt: { type: Date, default: null },
})

// "How often was this lecture opened, over this window" — the question the
// collection exists for, and the one the research export runs.
deckViewSchema.index({ deckId: 1, occurredAt: -1 })
// The same question per instructor, which cannot be answered by walking the
// lectures because a purged one takes its rows' only link with it.
deckViewSchema.index({ ownerId: 1, occurredAt: -1 })
// The retention sweep and any deployment-wide total walk by time alone.
deckViewSchema.index({ occurredAt: -1 })
// Sparse: rows written before depth existed carry no key at all, and a dense
// index would hold an entry for every one of them for a lookup that only ever
// names a live key.
deckViewSchema.index({ completionKey: 1 }, { sparse: true })

// Deliberately no soft-delete plugin, matching the cost ledger: a deleted
// lecture was still read, and a record that disappears with the thing it
// describes cannot answer what the deployment reached. The retention window
// bounds it instead.
export const DeckViewModel = defineModel<DeckViewDb>('DeckView', deckViewSchema)
