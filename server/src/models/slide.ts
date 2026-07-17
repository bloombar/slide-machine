/**
 * Slide model (SPEC §15 / GEN-6/GEN-7). layoutType is AI-chosen from the
 * template's descriptors; imageSource records provenance (IMG-4).
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import { LAYOUT_TYPES, type Slide } from '@slide-machine/shared'

export interface SlideDb extends Omit<Slide, 'id' | 'deckId'> {
  deckId: Types.ObjectId
}

const slideSchema = new Schema<SlideDb>({
  deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
  index: { type: Number, required: true },
  layoutType: { type: String, enum: LAYOUT_TYPES, required: true },
  title: String,
  body: String,
  bullets: { type: [String], default: undefined },
  imageRef: String,
  imageSource: { type: String, enum: ['seeded', 'stock', 'generated'] },
  imageKeywords: { type: [String], default: undefined },
  caption: String,
  sourceTranscript: String,
  // Image credit/licensing behind the "i" icon (IMG-5)
  attribution: {
    type: { sourceUrl: String, author: String, license: String },
    default: undefined,
    _id: false,
  },
})

slideSchema.index({ deckId: 1, index: 1 })

export const SlideModel = model<SlideDb>('Slide', slideSchema)

export const toSlideDto = (doc: HydratedDocument<SlideDb>): Slide => ({
  id: doc._id.toString(),
  deckId: doc.deckId.toString(),
  index: doc.index,
  layoutType: doc.layoutType,
  title: doc.title,
  body: doc.body,
  bullets: doc.bullets,
  imageRef: doc.imageRef,
  imageSource: doc.imageSource,
  imageKeywords: doc.imageKeywords,
  caption: doc.caption,
  sourceTranscript: doc.sourceTranscript,
  attribution: doc.attribution,
})
