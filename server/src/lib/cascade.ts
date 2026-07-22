/**
 * Deletion cascades shared by the owner-facing delete actions and the
 * admin moderation endpoints. Each helper removes a resource and
 * everything under it — slides, seed material (with stored files),
 * transcript segments, refine jobs, and retained session recordings —
 * so no caller has to know the full containment tree. Authorization is
 * the caller's job: owner actions check ownership first, admin routes
 * are gated by the allowlist.
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
import { getStorage } from '../storage'

/** Best-effort storage deletes: a dangling file is preferable to a
 * failed cascade, so individual failures are swallowed. */
const deleteStorageKeys = async (keys: string[]): Promise<void> => {
  const storage = getStorage()
  await Promise.all(keys.map(key => storage.delete(key).catch(() => {})))
}

/**
 * Removes everything stored under the given decks — slides, deck-level
 * seed assets (with files), transcript segments, refine jobs, and
 * retained recording audio — without deleting the deck documents
 * themselves (callers batch-delete those by their own filter).
 */
const deleteDeckContents = async (
  decks: HydratedDocument<DeckDb>[],
): Promise<void> => {
  if (decks.length === 0) return
  const deckIds = decks.map(d => d._id)
  const assets = await SeedAssetModel.find({ deckId: { $in: deckIds } })
  await deleteStorageKeys([
    ...assets.flatMap(a => (a.storageKey ? [a.storageKey] : [])),
    ...decks.flatMap(d => (d.recordings ?? []).map(r => r.audioKey)),
  ])
  await Promise.all([
    SlideModel.deleteMany({ deckId: { $in: deckIds } }),
    SeedAssetModel.deleteMany({ deckId: { $in: deckIds } }),
    TranscriptSegmentModel.deleteMany({ deckId: { $in: deckIds } }),
    RefineJobModel.deleteMany({ deckId: { $in: deckIds } }),
  ])
}

/** Deletes one deck (lecture) and everything stored under it. */
export const deleteDeckCascade = async (
  deck: HydratedDocument<DeckDb>,
): Promise<void> => {
  await deleteDeckContents([deck])
  await deck.deleteOne()
}

/** Deletes a project, every deck inside it (whoever owns them), all
 * seed material at both levels, and their stored files. */
export const deleteProjectCascade = async (
  projectId: string | Types.ObjectId,
): Promise<void> => {
  const decks = await DeckModel.find({ projectId })
  await deleteDeckContents(decks)
  // Project-level seed assets (deck-level ones are already gone)
  const assets = await SeedAssetModel.find({ projectId })
  await deleteStorageKeys(
    assets.flatMap(a => (a.storageKey ? [a.storageKey] : [])),
  )
  await Promise.all([
    SeedAssetModel.deleteMany({ projectId }),
    DeckModel.deleteMany({ projectId }),
  ])
  await ProjectModel.deleteOne({ _id: projectId })
}

/**
 * Deletes an account and all of its data: lectures the user owns
 * anywhere (including inside other users' projects), the user's own
 * projects with everything in them, their id in other users' sharing
 * lists, their sessions, and finally the account itself. The admin
 * action log is deliberately untouched — it is the audit trail.
 */
export const deleteUserCascade = async (userId: string): Promise<void> => {
  // Lectures owned anywhere, e.g. transferred into someone else's project
  const decks = await DeckModel.find({ ownerId: userId })
  await deleteDeckContents(decks)
  await DeckModel.deleteMany({ ownerId: userId })

  // Own projects, including decks other users own inside them
  const projects = await ProjectModel.find({ ownerId: userId })
  for (const project of projects) {
    await deleteProjectCascade(project._id)
  }

  // Scrub the id from everyone else's sharing lists and end all sessions
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
