/**
 * Retained-audio cleanup (GEN-4 Phase 2, BILL-3 retention). Lecture recordings
 * are purely intermediate — needed only until the batch-diarization pass
 * consumes them — and contain student voices, so they are not kept
 * indefinitely. A daily sweep deletes expired recordings: the audio in blob
 * storage AND its reference on the deck, so storage and the DB stay in sync.
 *
 * **How long is "expired" is per lecture owner.** Each plan tier sets its own
 * `audioRetentionDays` (BILL-3), and the deployment sets `AUDIO_RETENTION_DAYS`
 * on top. The **shorter of the two wins**: an operator who tightens the window
 * for privacy must not be overridden by a generous tier, and a tier that keeps
 * less must not be loosened by a permissive deployment. A tier's `null` means
 * it adds no bound of its own, so the deployment's window is what applies.
 *
 * `AUDIO_RETENTION_DAYS=0` keeps its established meaning — **the sweep is off
 * and nothing is ever deleted**, tiers included. It is the operator's blanket
 * override, consistent with every other `0`-removes-a-bound tunable, and the
 * only way to say "keep everything" without editing the plan config.
 *
 * Deleting also **credits the owner's `audioStorageMb` gauge back**, since that
 * metric is a stock — what is held right now — rather than a per-period total.
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
import type { PlanTier } from '@slide-machine/shared'
import { env } from '../config/env'
import { DeckModel } from '../models/deck'
import { UserModel } from '../models/user'
import { loadPlans } from '../config/plans'
import { adjustGauge, BYTES_PER_MB } from '../billing/usage'
import { effectivePlanTier, PLAN_FIELDS } from '../billing/plan-grant'
import { pcmBytesFor } from '../lib/wav'
import { getStorage } from '../storage'

const DAY_MS = 24 * 60 * 60 * 1000
/** Once a day; long-running enough that startup cost is negligible. */
const SWEEP_INTERVAL_MS = DAY_MS

/**
 * The retention window that actually applies to a tier: the shorter of the
 * tier's own and the deployment's. `0` for the deployment disables the sweep
 * entirely and is handled by the caller, so this is only reached with a real
 * deployment window; a tier's `null` means it adds no bound of its own.
 * Exported for the specs — the composition rule is the part worth pinning down.
 */
export const effectiveRetentionDays = (
  tierDays: number | null,
  deploymentDays: number,
): number =>
  tierDays !== null && tierDays > 0
    ? Math.min(tierDays, deploymentDays)
    : deploymentDays

/** Each tier's effective window, keyed by tier. */
const windowsByTier = (deploymentDays: number): Map<PlanTier, number> => {
  const plans = loadPlans()
  return new Map(
    (Object.keys(plans) as PlanTier[]).map(tier => [
      tier,
      effectiveRetentionDays(plans[tier].audioRetentionDays, deploymentDays),
    ]),
  )
}

/**
 * Deletes every retained recording past its owner's retention window,
 * returning the number removed. Best-effort per blob: a storage failure is
 * logged and the deck reference is still pulled, so a missing object can't
 * wedge the sweep.
 */
export const sweepExpiredRecordings = async (
  deploymentDays: number = env.AUDIO_RETENTION_DAYS,
  now: number = Date.now(),
): Promise<number> => {
  if (deploymentDays <= 0) return 0 // 0 = keep forever
  const windows = windowsByTier(deploymentDays)
  const shortest = Math.min(...windows.values(), deploymentDays)

  // Scan with the *shortest* window, which is the latest cutoff and therefore
  // the widest net: it catches every recording any tier could expire. Each deck
  // is then judged against its own owner's window.
  const widestCutoff = new Date(now - shortest * DAY_MS)
  const storage = getStorage()

  const decks = await DeckModel.find({
    'recordings.createdAt': { $lt: widestCutoff },
  })
  if (!decks.length) return 0

  // One lookup for every owner in the batch rather than one per deck: a sweep
  // over a busy deployment would otherwise re-read the same instructor's tier
  // once per lecture they own.
  const ownerIds = [...new Set(decks.map(d => d.ownerId.toString()))]
  const owners = await UserModel.find({ _id: { $in: ownerIds } }).select(
    PLAN_FIELDS,
  )
  // The effective tier, so a comped instructor's recordings are kept for the
  // window they were promised (ADMIN-9) rather than their own plan's. When the
  // grant lapses the window shortens again, and the next sweep collects what
  // has aged past it.
  const tierOf = new Map(
    owners.map(u => [u._id.toString(), effectivePlanTier(u)]),
  )

  let removed = 0
  for (const deck of decks) {
    const ownerId = deck.ownerId.toString()
    // An owner whose account is gone has no plan to read a window from, so the
    // tightest window in the config applies — orphaned student voices should
    // age out on the shortest terms the deployment offers anyone, not the
    // longest. There is likewise no gauge to credit, so that step is skipped.
    const tier = tierOf.get(ownerId)
    const days = (tier && windows.get(tier)) ?? shortest

    const cutoff = new Date(now - days * DAY_MS)
    const expired = (deck.recordings ?? []).filter(r => r.createdAt < cutoff)
    if (!expired.length) continue

    for (const rec of expired) {
      try {
        await storage.delete(rec.audioKey)
      } catch (error) {
        console.error(`Audio cleanup: failed to delete ${rec.audioKey}:`, error)
      }
    }
    await DeckModel.updateOne(
      { _id: deck._id },
      { $pull: { recordings: { createdAt: { $lt: cutoff } } } },
    )
    // Credited after the reference is pulled, so a crash mid-sweep leaves the
    // gauge overstating rather than understating — the safe direction, since
    // the next sweep re-runs the same deletion and settles it.
    if (tier) {
      const freed = expired.reduce(
        (mb, r) => mb + pcmBytesFor(r.durationMs, r.sampleRate) / BYTES_PER_MB,
        0,
      )
      await adjustGauge(ownerId, 'audioStorageMb', -freed)
    }
    removed += expired.length
  }
  if (removed)
    console.log(`Audio cleanup: removed ${removed} expired recording(s)`)
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
