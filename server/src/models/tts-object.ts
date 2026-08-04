/**
 * Reference index for cached TTS narration (P-11).
 *
 * Synthesized audio is stored under a hash of what produced it — provider,
 * language, voice and the spoken text (see `routes/tts.ts`) — so two lectures
 * whose narration is character-identical share one stored object. That sharing
 * is what makes replays free, and it is also why purging a lecture cannot
 * simply delete the files it played: another lecture may still be playing them.
 *
 * One row per stored object records which decks have played it. Purging a deck
 * drops its id, and the files are deleted only when the last id goes — so a
 * deleted lecture takes its narration with it without pulling audio out from
 * under anyone else.
 *
 * **Granularity is the deck, not the slide.** A row says a deck *has* played
 * this audio, not that it still would: rewriting a slide's narration leaves the
 * old entry referenced until the deck itself is purged. That keeps the playback
 * path to a single upsert, at the cost of a stale cache entry living as long as
 * the lecture that abandoned it.
 *
 * Objects synthesized before this index existed have no row, so nothing claims
 * them and nothing deletes them; a storage lifecycle rule on the `tts/` prefix
 * is the way to retire that backlog (docs/ADMINISTRATION.md).
 */
import { Schema, model, Types } from 'mongoose'

export interface TtsObjectDb {
  /** Object-storage key of the audio, e.g. `tts/<hash>.mp3`. Unique — it *is*
   * the cache entry's identity. */
  storageKey: string
  /** Key of the timepoint sidecar written alongside it, `tts/<hash>.json`. */
  marksKey: string
  /** Decks that have played this object; empty means nothing refers to it. */
  deckIds: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

/** Both keys one synthesis writes, derived from its cache hash. */
export interface TtsStorageKeys {
  storageKey: string
  marksKey: string
}

/**
 * Where a synthesis is stored, given its cache hash and the provider's audio
 * extension. The marks sidecar is always JSON, whatever the audio format.
 */
export const ttsStorageKeys = (
  hash: string,
  extension: string,
): TtsStorageKeys => ({
  storageKey: `tts/${hash}.${extension}`,
  marksKey: `tts/${hash}.json`,
})

const ttsObjectSchema = new Schema<TtsObjectDb>(
  {
    storageKey: { type: String, required: true, unique: true },
    marksKey: { type: String, required: true },
    deckIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Deck' }],
      default: [],
    },
  },
  { timestamps: true },
)

// Releasing a purged deck's references looks the object up by deck (multikey).
ttsObjectSchema.index({ deckIds: 1 })

export const TtsObjectModel = model<TtsObjectDb>('TtsObject', ttsObjectSchema)

/**
 * Records that `deckId` plays the object at these keys, creating the row on
 * first use. Idempotent, so it can run on every playback — including cache
 * hits, which is how a second deck reaching an object someone else paid for
 * comes to hold a reference of its own.
 */
export const retainTtsObject = async (
  keys: TtsStorageKeys,
  deckId: Types.ObjectId,
): Promise<void> => {
  await TtsObjectModel.updateOne(
    { storageKey: keys.storageKey },
    {
      // storageKey is seeded from the filter on insert; setting it here too
      // would conflict.
      $setOnInsert: { marksKey: keys.marksKey },
      $addToSet: { deckIds: deckId },
    },
    { upsert: true },
  )
}

/**
 * Drops these decks' references and returns the storage keys nothing refers to
 * any more, for the caller to delete. Rows that still have another deck are
 * left alone, so shared audio survives one of its lectures being purged.
 *
 * Returns audio and sidecar keys together — a sidecar that was never written
 * simply fails to delete, which the caller already tolerates.
 */
export const releaseTtsObjects = async (
  deckIds: (string | Types.ObjectId)[],
): Promise<string[]> => {
  if (deckIds.length === 0) return []
  const ids = deckIds.map(id => new Types.ObjectId(id))
  // Narrow to the rows these decks touch first, so the orphan check afterwards
  // reads back only those rather than scanning every cached object.
  const touched = await TtsObjectModel.find({ deckIds: { $in: ids } }).select(
    '_id',
  )
  if (touched.length === 0) return []
  const touchedIds = touched.map(doc => doc._id)
  await TtsObjectModel.updateMany(
    { _id: { $in: touchedIds } },
    { $pull: { deckIds: { $in: ids } } },
  )
  const orphaned = await TtsObjectModel.find({
    _id: { $in: touchedIds },
    deckIds: { $size: 0 },
  })
  if (orphaned.length === 0) return []
  await TtsObjectModel.deleteMany({
    _id: { $in: orphaned.map(doc => doc._id) },
  })
  return orphaned.flatMap(doc => [doc.storageKey, doc.marksKey])
}
