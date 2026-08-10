/**
 * Retention purge for soft-deleted records (P-10/P-11). Deleting anything only
 * tombstones it (`deletedAt`); this daily sweep permanently removes tombstones
 * older than DELETED_DATA_RETENTION_DAYS — the records AND their stored files —
 * so deleted data is recoverable for the window and then truly gone.
 *
 * Top-level entities are purged through their cascade (a user takes its projects
 * and lectures; a project takes its lectures), which hard-deletes each subtree's
 * children and files. Whatever remains — children tombstoned on their own while
 * their parent stayed live (an individually deleted slide or seed asset) — is
 * then swept directly. `DELETED_DATA_RETENTION_DAYS = 0` disables the sweep.
 *
 * The sweep also collects template versions no lecture pins any more (TMPL-11),
 * which have no tombstone of their own and would otherwise accumulate forever.
 */
import { env } from '../config/env'
import { UserModel } from '../models/user'
import { ProjectModel } from '../models/project'
import { DeckModel } from '../models/deck'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { RefineJobModel } from '../models/refine-job'
import { TemplateVersionModel } from '../models/template-version'
import { getStorage } from '../storage'
import {
  purgeUserCascade,
  purgeProjectCascade,
  purgeDeckCascade,
} from '../lib/cascade'

const DAY_MS = 24 * 60 * 60 * 1000
/** Once a day; startup cost is negligible against the retention window. */
const SWEEP_INTERVAL_MS = DAY_MS

/**
 * Removes template versions no lecture pins any more (TMPL-11 / P-11),
 * returning how many went.
 *
 * Versions sit outside the delete cascade deliberately — a lecture may outlive
 * both its template and its author, so tombstoning a version with either would
 * take working lectures down with it. That leaves nothing else to collect them:
 * every edit of a template mints a row, and each one stays behind for good once
 * the lectures that pinned it are gone. This is the sweep the model docstring
 * points at.
 *
 * A version counts as pinned when any lecture holds it, **tombstoned lectures
 * included** — one restored inside the retention window (P-10) has to come back
 * drawn the way it was, so `withDeleted` is set rather than left to the
 * exclusion middleware.
 *
 * Only versions older than the same retention cutoff are candidates, which also
 * settles a race the reference check alone would lose: `currentVersionIdFor`
 * writes the version before the lecture that will pin it exists, and a sweep
 * landing between the two must not take it.
 */
const purgeUnpinnedTemplateVersions = async (cutoff: Date): Promise<number> => {
  const candidates = await TemplateVersionModel.find({
    createdAt: { $lt: cutoff },
  }).select('_id')
  if (!candidates.length) return 0

  const pinning = await DeckModel.find({
    templateVersionId: { $in: candidates.map(v => v._id.toString()) },
  })
    .select('templateVersionId')
    .setOptions({ withDeleted: true })
  const pinned = new Set(pinning.map(d => d.templateVersionId))

  const orphans = candidates.filter(v => !pinned.has(v._id.toString()))
  if (!orphans.length) return 0
  const result = await TemplateVersionModel.deleteMany({
    _id: { $in: orphans.map(v => v._id) },
  })
  return result.deletedCount ?? 0
}

/**
 * Permanently removes every record tombstoned before the retention cutoff,
 * returning the number purged. `withDeleted` is set so the queries reach the
 * tombstoned rows; deletes are unaffected by the exclusion middleware.
 */
export const purgeExpiredSoftDeletes = async (
  olderThanDays: number = env.DELETED_DATA_RETENTION_DAYS,
  now: number = Date.now(),
): Promise<number> => {
  if (olderThanDays <= 0) return 0 // 0 = keep tombstones forever
  const cutoff = new Date(now - olderThanDays * DAY_MS)
  const expired = { deletedAt: { $lt: cutoff } }
  const seen = { withDeleted: true }
  let purged = 0

  // Users first — their cascade takes their projects and lectures with them.
  const users = await UserModel.find(expired).select('_id').setOptions(seen)
  for (const u of users) {
    await purgeUserCascade(u._id.toString())
    purged += 1
  }

  // Then projects owned by still-present users.
  const projects = await ProjectModel.find(expired)
    .select('_id')
    .setOptions(seen)
  for (const p of projects) {
    await purgeProjectCascade(p._id)
    purged += 1
  }

  // Then lectures deleted on their own (their project stayed live).
  const decks = await DeckModel.find(expired).select('_id').setOptions(seen)
  for (const d of decks) {
    await purgeDeckCascade(d._id)
    purged += 1
  }

  // Finally, children tombstoned individually while their parent stayed live.
  const assets = await SeedAssetModel.find(expired).setOptions(seen)
  const storage = getStorage()
  await Promise.all(
    assets.flatMap(a =>
      a.storageKey ? [storage.delete(a.storageKey).catch(() => {})] : [],
    ),
  )
  const results = await Promise.all([
    SeedAssetModel.deleteMany(expired),
    SlideModel.deleteMany(expired),
    TranscriptSegmentModel.deleteMany(expired),
    RefineJobModel.deleteMany(expired),
  ])
  purged += results.reduce((n, r) => n + (r.deletedCount ?? 0), 0)

  // Last, so the lectures purged above have already released their pins and
  // the versions they were holding go in the same sweep rather than the next.
  purged += await purgeUnpinnedTemplateVersions(cutoff)

  if (purged)
    console.log(`Soft-delete purge: removed ${purged} expired record(s)`)
  return purged
}

/**
 * Starts the daily purge sweep (once now, then on an interval). No-op when
 * DELETED_DATA_RETENTION_DAYS is 0. The interval is unref'd so it never keeps
 * the process alive. Returns a stop function.
 */
export const startSoftDeletePurgeSweep = (): (() => void) => {
  if (env.DELETED_DATA_RETENTION_DAYS <= 0) return () => {}
  const run = (): void => {
    void purgeExpiredSoftDeletes().catch(error =>
      console.error('Soft-delete purge sweep failed:', error),
    )
  }
  run()
  const timer = setInterval(run, SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
