/**
 * Seed-asset management actions (SEED-1 via TECH-13): list one level's
 * assets, edit caption/enabled, delete (including the stored file).
 * Project-level assets are owner-only; lecture-level ones follow deck
 * edit rights, mirroring the upload route.
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  SeedAsset,
  SeedAssetDeleteInput,
  SeedAssetListInput,
  SeedAssetUpdateInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import { ProjectModel, projectAcl } from '../models/project'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { canEditAcl } from '../lib/access'
import {
  SeedAssetModel,
  toSeedAssetDto,
  type SeedAssetDb,
} from '../models/seed-asset'

const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/** May `ctx` manage assets at this level? Same rules as the upload route. */
const authorizeLevel = async (
  ctx: ActionContext,
  projectId: string,
  deckId?: string,
): Promise<void> => {
  const userId = requireUser(ctx)
  if (deckId) {
    const deck = await DeckModel.findById(deckId).catch(() => null)
    if (!deck || !canEditAcl(await loadDeckAcl(deck), userId))
      throw new ActionForbiddenError()
    return
  }
  const project = await ProjectModel.findById(projectId).catch(() => null)
  if (!project || !canEditAcl(projectAcl(project), userId))
    throw new ActionForbiddenError()
}

const loadManagedAsset = async (
  ctx: ActionContext,
  assetId: string,
): Promise<HydratedDocument<SeedAssetDb>> => {
  const asset = await SeedAssetModel.findById(assetId).catch(() => null)
  if (!asset) throw new ActionForbiddenError()
  await authorizeLevel(
    ctx,
    asset.projectId.toString(),
    asset.deckId?.toString(),
  )
  return asset
}

export const seedAssetList = defineAction<SeedAssetListInput, SeedAsset[]>({
  name: 'seedAsset.list',
  input: z.object({
    projectId: z.string().min(1).optional(),
    deckId: z.string().min(1).optional(),
  }),
  execute: async (ctx, input) => {
    if (!input.projectId && !input.deckId) {
      throw new ActionValidationError('seedAsset.list', [
        'provide projectId or deckId',
      ])
    }
    if (input.deckId) {
      await authorizeLevel(ctx, '', input.deckId)
      const docs = await SeedAssetModel.find({ deckId: input.deckId }).sort({
        createdAt: -1,
      })
      return docs.map(toSeedAssetDto)
    }
    await authorizeLevel(ctx, input.projectId!)
    const docs = await SeedAssetModel.find({
      projectId: input.projectId,
      deckId: { $exists: false },
    }).sort({ createdAt: -1 })
    return docs.map(toSeedAssetDto)
  },
})

export const seedAssetUpdate = defineAction<SeedAssetUpdateInput, SeedAsset>({
  name: 'seedAsset.update',
  input: z.object({
    assetId: z.string().min(1),
    caption: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
  }),
  execute: async (ctx, input) => {
    const asset = await loadManagedAsset(ctx, input.assetId)
    if (input.caption !== undefined) {
      asset.caption = input.caption
      // Captions double as search keywords for photo enrichment
      if (asset.type === 'image') {
        asset.keywords = [
          ...new Set(
            input.caption
              .toLowerCase()
              .split(/[^a-z]+/)
              .filter(word => word.length > 2),
          ),
        ]
      }
    }
    if (input.enabled !== undefined) asset.enabled = input.enabled
    await asset.save()
    return toSeedAssetDto(asset)
  },
})

export const seedAssetDelete = defineAction<
  SeedAssetDeleteInput,
  { deleted: true }
>({
  name: 'seedAsset.delete',
  input: z.object({ assetId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const asset = await loadManagedAsset(ctx, input.assetId)
    // Soft delete (P-10): tombstone the asset; the stored file is kept for
    // restore and removed later by the retention purge.
    asset.deletedAt = new Date()
    await asset.save()
    return { deleted: true }
  },
})

registerAction(seedAssetList)
registerAction(seedAssetUpdate)
registerAction(seedAssetDelete)
