/**
 * Retained-audio cleanup (GEN-4 Phase 2). Lecture recordings are purely
 * intermediate — needed only until the batch-diarization pass consumes them —
 * and contain student voices, so they are not kept indefinitely. A daily sweep
 * deletes any recording older than AUDIO_RETENTION_DAYS: the WAV in blob
 * storage AND its reference on the deck, so storage and the DB stay in sync.
 *
 * This is the time-based backstop. Phase 3 additionally deletes a recording as
 * soon as diarization has consumed it (more eager), leaving only un-processed
 * audio for this sweep to catch. A `gs://` copy, once Phase 3 adds one, must be
 * removed here too.
 *
 * Object-storage lifecycle rules (S3/Spaces expiry on the `audio/` prefix) are
 * a complementary zero-code guard, but they leave the deck reference dangling;
 * this app-side sweep is what keeps the two consistent.
 */
import { env } from '../config/env'
import { DeckModel } from '../models/deck'
import { getStorage } from '../storage'

const DAY_MS = 24 * 60 * 60 * 1000
/** Once a day; long-running enough that startup cost is negligible. */
const SWEEP_INTERVAL_MS = DAY_MS

/**
 * Deletes every retained recording older than `olderThanDays`, returning the
 * number removed. Best-effort per blob: a storage failure is logged and the
 * deck reference is still pulled, so a missing object can't wedge the sweep.
 */
export const sweepExpiredRecordings = async (
  olderThanDays: number = env.AUDIO_RETENTION_DAYS,
  now: number = Date.now(),
): Promise<number> => {
  if (olderThanDays <= 0) return 0 // 0 = keep forever
  const cutoff = new Date(now - olderThanDays * DAY_MS)
  const storage = getStorage()

  const decks = await DeckModel.find({ 'recordings.createdAt': { $lt: cutoff } })
  let removed = 0
  for (const deck of decks) {
    const expired = (deck.recordings ?? []).filter(r => r.createdAt < cutoff)
    for (const rec of expired) {
      try {
        await storage.delete(rec.audioKey)
      } catch (error) {
        console.error(
          `Audio cleanup: failed to delete ${rec.audioKey}:`,
          error,
        )
      }
    }
    await DeckModel.updateOne(
      { _id: deck._id },
      { $pull: { recordings: { createdAt: { $lt: cutoff } } } },
    )
    removed += expired.length
  }
  if (removed) console.log(`Audio cleanup: removed ${removed} expired recording(s)`)
  return removed
}

/**
 * Starts the daily cleanup sweep (once now, then on an interval). No-op when
 * AUDIO_RETENTION_DAYS is 0. The interval is unref'd so it never keeps the
 * process alive. Returns a stop function.
 */
export const startAudioRetentionSweep = (): (() => void) => {
  if (env.AUDIO_RETENTION_DAYS <= 0) return () => {}
  const run = (): void => {
    void sweepExpiredRecordings().catch(error =>
      console.error('Audio cleanup sweep failed:', error),
    )
  }
  run()
  const timer = setInterval(run, SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
