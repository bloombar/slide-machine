/**
 * Seed asset model (SEED-1/SEED-2): one uploaded file (or an image
 * extracted from one), its extracted text/keywords, and its lifecycle
 * status. storageKey stays server-side; clients get a public URL.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { SeedAsset } from '@slide-machine/shared'

export interface SeedAssetDb extends Omit<
  SeedAsset,
  'id' | 'projectId' | 'deckId' | 'createdAt'
> {
  projectId: Types.ObjectId
  deckId?: Types.ObjectId
  /** Storage key of the original file (absent for extracted children). */
  storageKey?: string
  createdAt: Date
}

const seedAssetSchema = new Schema<SeedAssetDb>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', index: true },
    type: {
      type: String,
      enum: ['doc', 'pdf', 'gdoc', 'gdrive', 'gslides', 'image'],
      required: true,
    },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['processing', 'ready', 'failed'],
      default: 'processing',
    },
    text: String,
    imageUrl: String,
    caption: String,
    keywords: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    storageKey: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const SeedAssetModel = model<SeedAssetDb>('SeedAsset', seedAssetSchema)

export const toSeedAssetDto = (
  doc: HydratedDocument<SeedAssetDb>,
): SeedAsset => ({
  id: doc._id.toString(),
  projectId: doc.projectId.toString(),
  deckId: doc.deckId?.toString(),
  type: doc.type,
  name: doc.name,
  status: doc.status,
  text: doc.text,
  imageUrl: doc.imageUrl,
  caption: doc.caption,
  keywords: doc.keywords,
  enabled: doc.enabled,
  createdAt: doc.createdAt.toISOString(),
})
