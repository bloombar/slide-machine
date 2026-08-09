/**
 * Seed-asset management actions (SEED-1 via TECH-13): list one level's
 * assets, edit caption/enabled, delete (including the stored file).
 * Project-level assets are owner-only; lecture-level ones follow deck
 * edit rights, mirroring the upload route.
 */
import { z } from 'zod'
import type {
  SeedAsset,
  SeedAssetDeleteInput,
  SeedAssetListInput,
  SeedAssetUpdateInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  seedAssetEditor,
  seedAssetLevel,
  type SeedAssetAccess,
  type SeedAssetLevel,
} from './access'
import { registerAction } from './dispatch'
import { SeedAssetModel, toSeedAssetDto } from '../models/seed-asset'

export const seedAssetList = defineAction<
  SeedAssetListInput,
  SeedAsset[],
  { userId: string; level: SeedAssetLevel }
>({
  name: 'seedAsset.list',
  // The level is a property of the request: a lecture id names the lecture's
  // own material, otherwise the project's.
  access: seedAssetLevel(),
  input: z.object({
    projectId: z.string().min(1).optional(),
    deckId: z.string().min(1).optional(),
  }),
  execute: async (ctx, input) => {
    if (input.deckId) {
      const docs = await SeedAssetModel.find({ deckId: input.deckId }).sort({
        createdAt: -1,
      })
      return docs.map(toSeedAssetDto)
    }
    const docs = await SeedAssetModel.find({
      projectId: input.projectId,
      deckId: { $exists: false },
    }).sort({ createdAt: -1 })
    return docs.map(toSeedAssetDto)
  },
})

export const seedAssetUpdate = defineAction<
  SeedAssetUpdateInput,
  SeedAsset,
  SeedAssetAccess
>({
  name: 'seedAsset.update',
  access: seedAssetEditor(),
  input: z.object({
    assetId: z.string().min(1),
    caption: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
  }),
  execute: async (ctx, input, { asset }) => {
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
  { deleted: true },
  SeedAssetAccess
>({
  name: 'seedAsset.delete',
  access: seedAssetEditor(),
  input: z.object({ assetId: z.string().min(1) }),
  execute: async (ctx, input, { asset }) => {
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
