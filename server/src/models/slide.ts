/**
 * Slide model (SPEC §15 / GEN-6/GEN-7). layoutType is AI-chosen from the
 * template's descriptors; imageSource records provenance (IMG-4).
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import {
  LAYOUT_TYPES,
  type ImageAttribution,
  type Slide,
} from '@slide-machine/shared'

export interface SlideDb extends Omit<Slide, 'id' | 'deckId'> {
  deckId: Types.ObjectId
}

/**
 * Source-agnostic image credit (IMG-5). Stored as Mixed rather than a
 * strict subdocument on purpose: slides enriched before IMG-5 hold a
 * plain STRING here (the old flat credit), and a subdocument schema
 * throws an uncastable-value error the moment Mongoose hydrates such a
 * row — crashing every read of that slide. Mixed hydrates any legacy
 * value without casting; `toAttributionDto` normalizes it on the way out.
 * All current writers produce a well-formed ImageAttribution object.
 */
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
  attribution: { type: Schema.Types.Mixed, default: undefined },
  manuallyEdited: { type: Boolean, default: undefined },
})

slideSchema.index({ deckId: 1, index: 1 })

export const SlideModel = model<SlideDb>('Slide', slideSchema)

/**
 * Normalizes a stored attribution value to the DTO shape. Legacy rows
 * (pre-IMG-5) hold a plain string here; anything that isn't an object
 * becomes undefined, so old slides surface with no structured credit
 * rather than leaking a raw string into a typed field.
 */
export const toAttributionDto = (
  value: unknown,
): ImageAttribution | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const a = value as Partial<ImageAttribution>
  return {
    caption: a.caption,
    title: a.title,
    creator: a.creator,
    creatorUrl: a.creatorUrl,
    sourceUrl: a.sourceUrl,
    sourceName: a.sourceName,
    license: a.license,
    licenseUrl: a.licenseUrl,
  }
}

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
  attribution: toAttributionDto(doc.attribution),
  manuallyEdited: doc.manuallyEdited,
})
