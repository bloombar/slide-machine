/**
 * Deletion cascades shared by the owner-facing delete actions and the admin
 * moderation endpoints (P-10 soft delete). Deleting a resource **tombstones** it
 * and everything under it — slides, seed material, transcript segments, refine
 * jobs — by stamping `deletedAt`, so the whole subtree vanishes from reads at
 * once and can be restored during the retention window. Stored files (audio,
 * seed blobs) are intentionally kept until the retention purge hard-deletes them
 * (see `purge*`), so a restore brings everything back.
 *
 * Authorization is the caller's job: owner actions check ownership first, admin
 * routes are gated by the allowlist. Sessions (refresh tokens) are always hard-
 * deleted so a deleted account is signed out immediately; the admin action log
 * is never touched — it is the audit trail.
 */
import type { HydratedDocument, Types } from 'mongoose'
import { ProjectModel } from '../models/project'
import { DeckModel, type DeckDb } from '../models/deck'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { RefineJobModel } from '../models/refine-job'
import { RefreshTokenModel } from '../models/refresh-token'
import { UserModel } from '../models/user'
import { VoteModel } from '../models/vote'
import { adjustGauge, BYTES_PER_MB } from '../billing/usage'
import { pcmBytesFor } from './wav'
import { getStorage } from '../storage'

// ─── Soft delete (tombstone) ────────────────────────────────────────────────

/** Tombstones everything stored under the given decks (slides, seed assets,
 * transcript segments, refine jobs). The update filter excludes already-deleted
 * rows, so their earlier `deletedAt` timestamp is preserved. */
const tombstoneDeckContents = async (
  deckIds: Types.ObjectId[],
  at: Date,
): Promise<void> => {
  if (deckIds.length === 0) return
  const by = { deckId: { $in: deckIds } }
  await Promise.all([
    SlideModel.updateMany(by, { deletedAt: at }),
    SeedAssetModel.updateMany(by, { deletedAt: at }),
    TranscriptSegmentModel.updateMany(by, { deletedAt: at }),
    RefineJobModel.updateMany(by, { deletedAt: at }),
  ])
}

/** Soft-deletes one deck (lecture) and everything stored under it. */
export const deleteDeckCascade = async (
  deck: HydratedDocument<DeckDb>,
): Promise<void> => {
  const at = new Date()
  await tombstoneDeckContents([deck._id], at)
  deck.deletedAt = at
  await deck.save()
}

/** Soft-deletes a project, every deck inside it (whoever owns them), and all
 * seed material at both levels. */
export const deleteProjectCascade = async (
  projectId: string | Types.ObjectId,
): Promise<void> => {
  const at = new Date()
  const decks = await DeckModel.find({ projectId }).select('_id')
  await tombstoneDeckContents(
    decks.map(d => d._id),
    at,
  )
  await Promise.all([
    SeedAssetModel.updateMany({ projectId }, { deletedAt: at }),
    DeckModel.updateMany({ projectId }, { deletedAt: at }),
  ])
  await ProjectModel.updateOne({ _id: projectId }, { deletedAt: at })
}

/**
 * Soft-deletes an account and all of its data: lectures the user owns anywhere
 * (including inside other users' projects) and their own projects with
 * everything in them. Sessions are hard-deleted so the account is signed out at
 * once. Sharing-list scrubbing is deferred to the purge (a tombstoned user
 * cannot act, and keeping the lists makes a restore clean).
 */
export const deleteUserCascade = async (userId: string): Promise<void> => {
  const at = new Date()
  // Lectures owned anywhere, e.g. transferred into someone else's project
  const owned = await DeckModel.find({ ownerId: userId }).select('_id')
  await tombstoneDeckContents(
    owned.map(d => d._id),
    at,
  )
  await DeckModel.updateMany({ ownerId: userId }, { deletedAt: at })

  // Own projects, including decks other users own inside them
  const projects = await ProjectModel.find({ ownerId: userId }).select('_id')
  for (const project of projects) {
    await deleteProjectCascade(project._id)
  }

  // Scrub the id from everyone else's sharing lists (a banned/deleted user
  // must not retain access) and end all sessions immediately.
  await Promise.all([
    ProjectModel.updateMany(
      {},
      { $pull: { viewers: userId, editors: userId } },
    ),
    DeckModel.updateMany(
      { accessOverride: { $exists: true } },
      {
        $pull: {
          'accessOverride.viewers': userId,
          'accessOverride.editors': userId,
        },
      },
    ),
    RefreshTokenModel.deleteMany({ userId }),
  ])
  await UserModel.updateOne({ _id: userId }, { deletedAt: at })
}

// ─── Restore (admin recovery, ADMIN-6) ──────────────────────────────────────

/** Un-tombstones the deck plus the children tombstoned in the same cascade
 * (deletedAt at or after the deck's), so a child deleted earlier stays deleted. */
export const restoreDeckCascade = async (
  deckId: string | Types.ObjectId,
): Promise<void> => {
  const deck = await DeckModel.findById(deckId).setOptions({
    withDeleted: true,
  })
  if (!deck?.deletedAt) return
  const at = deck.deletedAt
  const seen = { withDeleted: true }
  const by = { deckId: deck._id, deletedAt: { $gte: at } }
  await Promise.all([
    SlideModel.updateMany(by, { deletedAt: null }).setOptions(seen),
    SeedAssetModel.updateMany(by, { deletedAt: null }).setOptions(seen),
    TranscriptSegmentModel.updateMany(by, { deletedAt: null }).setOptions(seen),
    RefineJobModel.updateMany(by, { deletedAt: null }).setOptions(seen),
  ])
  await DeckModel.updateOne({ _id: deck._id }, { deletedAt: null }).setOptions(
    seen,
  )
}

/** Un-tombstones a project and everything tombstoned with it. */
export const restoreProjectCascade = async (
  projectId: string | Types.ObjectId,
): Promise<void> => {
  const project = await ProjectModel.findById(projectId).setOptions({
    withDeleted: true,
  })
  if (!project?.deletedAt) return
  const at = project.deletedAt
  const seen = { withDeleted: true }
  const decks = await DeckModel.find({ projectId, deletedAt: { $gte: at } })
    .select('_id')
    .setOptions(seen)
  for (const d of decks) await restoreDeckCascade(d._id)
  await SeedAssetModel.updateMany(
    { projectId, deletedAt: { $gte: at } },
    { deletedAt: null },
  ).setOptions(seen)
  await ProjectModel.updateOne(
    { _id: project._id },
    { deletedAt: null },
  ).setOptions(seen)
}

/** Un-tombstones an account and everything tombstoned with it (its owned
 * lectures anywhere and its own projects). */
export const restoreUserCascade = async (userId: string): Promise<void> => {
  const user = await UserModel.findById(userId).setOptions({
    withDeleted: true,
  })
  if (!user?.deletedAt) return
  const at = user.deletedAt
  const seen = { withDeleted: true }
  const decks = await DeckModel.find({
    ownerId: userId,
    deletedAt: { $gte: at },
  })
    .select('_id')
    .setOptions(seen)
  for (const d of decks) await restoreDeckCascade(d._id)
  const projects = await ProjectModel.find({
    ownerId: userId,
    deletedAt: { $gte: at },
  })
    .select('_id')
    .setOptions(seen)
  for (const p of projects) await restoreProjectCascade(p._id)
  await UserModel.updateOne({ _id: userId }, { deletedAt: null }).setOptions(
    seen,
  )
}

// ─── Hard delete (retention purge) ──────────────────────────────────────────

/** Best-effort storage deletes: a dangling file is preferable to a failed
 * cascade, so individual failures are swallowed. */
const deleteStorageKeys = async (keys: string[]): Promise<void> => {
  const storage = getStorage()
  await Promise.all(keys.map(key => storage.delete(key).catch(() => {})))
}

/** Permanently removes everything stored under the given decks (records + files).
 * Runs `withDeleted` so it reaches the tombstoned rows the purge targets. */
const purgeDeckContents = async (
  deckIds: (string | Types.ObjectId)[],
): Promise<void> => {
  if (deckIds.length === 0) return
  const by = { deckId: { $in: deckIds } }
  const opts = { withDeleted: true }
  const [assets, decks] = await Promise.all([
    SeedAssetModel.find(by).setOptions(opts),
    DeckModel.find({ _id: { $in: deckIds } }).setOptions(opts),
  ])
  await deleteStorageKeys([
    ...assets.flatMap(a => (a.storageKey ? [a.storageKey] : [])),
    ...decks.flatMap(d => (d.recordings ?? []).map(r => r.audioKey)),
  ])
  // Deleting a lecture gives its owner their storage back (BILL-3). Without
  // this the gauge only ever climbs, and a user who deleted everything would
  // still be told they are full.
  await creditRetainedAudio(decks)
  await Promise.all([
    SlideModel.deleteMany(by),
    SeedAssetModel.deleteMany(by),
    TranscriptSegmentModel.deleteMany(by),
    RefineJobModel.deleteMany(by),
    // Votes on the purged decks (SOC-1) — nothing to restore, so drop them.
    VoteModel.deleteMany({ targetType: 'deck', targetId: { $in: deckIds } }),
  ])
}

/**
 * Credits each deck owner's `audioStorageMb` gauge for the recordings about to
 * be purged, summed per owner so a project-wide purge is one write per person
 * rather than one per lecture.
 */
const creditRetainedAudio = async (
  decks: HydratedDocument<DeckDb>[],
): Promise<void> => {
  const freedByOwner = new Map<string, number>()
  for (const deck of decks) {
    for (const rec of deck.recordings ?? []) {
      const owner = deck.ownerId.toString()
      const mb = pcmBytesFor(rec.durationMs, rec.sampleRate) / BYTES_PER_MB
      freedByOwner.set(owner, (freedByOwner.get(owner) ?? 0) + mb)
    }
  }
  for (const [ownerId, mb] of freedByOwner) {
    await adjustGauge(ownerId, 'audioStorageMb', -mb)
  }
}

/** Permanently removes one deck and everything under it (records + files). */
export const purgeDeckCascade = async (
  deckId: string | Types.ObjectId,
): Promise<void> => {
  await purgeDeckContents([deckId])
  await DeckModel.deleteOne({ _id: deckId })
}

/** Permanently removes a project and everything inside it (records + files). */
export const purgeProjectCascade = async (
  projectId: string | Types.ObjectId,
): Promise<void> => {
  const decks = await DeckModel.find({ projectId })
    .select('_id')
    .setOptions({ withDeleted: true })
  await purgeDeckContents(decks.map(d => d._id))
  const assets = await SeedAssetModel.find({ projectId }).setOptions({
    withDeleted: true,
  })
  await deleteStorageKeys(
    assets.flatMap(a => (a.storageKey ? [a.storageKey] : [])),
  )
  await Promise.all([
    SeedAssetModel.deleteMany({ projectId }),
    DeckModel.deleteMany({ projectId }),
  ])
  await ProjectModel.deleteOne({ _id: projectId })
}

/** Permanently removes an account and all of its data (records + files), and
 * scrubs the id from everyone else's sharing lists. */
export const purgeUserCascade = async (userId: string): Promise<void> => {
  const decks = await DeckModel.find({ ownerId: userId })
    .select('_id')
    .setOptions({ withDeleted: true })
  await purgeDeckContents(decks.map(d => d._id))
  await DeckModel.deleteMany({ ownerId: userId })

  const projects = await ProjectModel.find({ ownerId: userId })
    .select('_id')
    .setOptions({ withDeleted: true })
  for (const project of projects) {
    await purgeProjectCascade(project._id)
  }

  await Promise.all([
    ProjectModel.updateMany(
      {},
      { $pull: { viewers: userId, editors: userId } },
    ),
    DeckModel.updateMany(
      { accessOverride: { $exists: true } },
      {
        $pull: {
          'accessOverride.viewers': userId,
          'accessOverride.editors': userId,
        },
      },
    ),
    RefreshTokenModel.deleteMany({ userId }),
  ])
  await UserModel.deleteOne({ _id: userId })
}
