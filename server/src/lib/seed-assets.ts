/**
 * Seed-asset helpers shared by the generation pipeline and on-demand
 * enrichment: which of a lecture's uploaded assets apply, and how an
 * uploaded image becomes an enrichment candidate with its provenance.
 */
import type { HydratedDocument } from 'mongoose'
import type { ImageAttribution } from '@slide-machine/shared'
import { SeedAssetModel, type SeedAssetDb } from '../models/seed-asset'
import type { DeckDb } from '../models/deck'
import type { ImageCandidate } from '../enrichment/types'

export type SeedAssetDoc = HydratedDocument<SeedAssetDb>

/** Enabled, extracted seed assets that apply to a lecture: the project's
 * own plus the deck's (additive layering, SEED-1). */
export const seedAssetsFor = async (
  deck: HydratedDocument<DeckDb>,
): Promise<{ project: SeedAssetDoc[]; deck: SeedAssetDoc[] }> => {
  const docs = await SeedAssetModel.find({
    projectId: deck.projectId,
    enabled: true,
    status: 'ready',
    $or: [{ deckId: { $exists: false } }, { deckId: deck._id }],
  })
  return {
    project: docs.filter(a => !a.deckId),
    deck: docs.filter(a => a.deckId),
  }
}

/** Provenance credit for an instructor's own upload (IMG-5): the asset's
 * caption/name and our own source label — seeded uploads carry no external
 * license or creator to attribute. */
export const seededAttribution = (asset: SeedAssetDoc): ImageAttribution => ({
  caption: asset.caption || undefined,
  title: asset.caption || asset.name,
  sourceName: 'Instructor upload',
})

/** An instructor's image uploads as enrichment candidates; they carry the
 * highest source prior in the ranker (IMG-1). */
export const seededImageCandidates = (
  assets: SeedAssetDoc[],
): ImageCandidate[] =>
  assets
    .filter(a => a.type === 'image' && a.imageUrl)
    .map(a => ({
      url: a.imageUrl!,
      title: a.caption ?? a.name,
      tags: a.keywords,
      source: 'seeded' as const,
      attribution: seededAttribution(a),
    }))
