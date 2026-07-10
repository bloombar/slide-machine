/**
 * Deck model (SPEC §15 / SHARE-1). The transcript field retains the full
 * finalized lecture text for post-lecture reformatting (GEN-4).
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { Deck } from '@slide-machine/shared'

export interface DeckDb extends Omit<
  Deck,
  'id' | 'projectId' | 'ownerId' | 'createdAt'
> {
  projectId: Types.ObjectId
  ownerId: Types.ObjectId
  createdAt: Date
}

const deckSchema = new Schema<DeckDb>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    templateId: { type: String, required: true },
    visibility: {
      type: String,
      enum: ['private', 'unlisted', 'public'],
      default: 'private',
    },
    permalinkSlug: { type: String, required: true, unique: true },
    slideOrder: { type: [String], default: [] },
    transcript: String,
    voteScore: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const DeckModel = model<DeckDb>('Deck', deckSchema)

export const toDeckDto = (doc: HydratedDocument<DeckDb>): Deck => ({
  id: doc._id.toString(),
  projectId: doc.projectId.toString(),
  ownerId: doc.ownerId.toString(),
  title: doc.title,
  templateId: doc.templateId,
  visibility: doc.visibility,
  permalinkSlug: doc.permalinkSlug,
  slideOrder: doc.slideOrder,
  transcript: doc.transcript,
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
})
