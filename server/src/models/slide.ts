/**
 * Slide model (SPEC §15 / GEN-6/GEN-7). layoutType is AI-chosen from the
 * template's descriptors; imageSource records provenance (IMG-4).
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import {
  LAYOUT_TYPES,
  type ImageAttribution,
  type Slide,
  type Stroke,
  type StrokeAnchor,
  type StrokePoint,
} from '@slide-machine/shared'

export interface SlideDb extends Omit<Slide, 'id' | 'deckId'> {
  deckId: Types.ObjectId
  /** Hash of the inputs that produced the current narration (role turns +
   * level + language). Lets a diarized slide skip re-narration when nothing
   * changed, so repeated Refines are idempotent. Server-internal — not in the
   * Slide DTO. */
  narrateInputHash?: string
}

/** Id-less subdocuments for whiteboard strokes (WB-1). Strict schemas keep
 * stored drawings well-formed; mirrors the transcript-segment wordSchema. */
const pointSchema = new Schema<StrokePoint>(
  { x: { type: Number, required: true }, y: { type: Number, required: true } },
  { _id: false },
)

const STROKE_SOURCES: StrokeAnchor['source'][] = [
  'word',
  'appended',
  'elapsed',
  'unsynced',
]

const anchorSchema = new Schema<StrokeAnchor>(
  {
    charAnchor: { type: Number, required: true },
    source: { type: String, enum: STROKE_SOURCES, required: true },
    sessionId: String,
    sessionMs: Number,
    phraseText: String,
    phraseOffset: Number,
    orphaned: Boolean,
  },
  { _id: false },
)

const strokeSchema = new Schema<Stroke>(
  {
    id: { type: String, required: true },
    tool: { type: String, enum: ['pen', 'highlighter'], required: true },
    color: { type: String, required: true },
    thickness: { type: Number, required: true },
    points: { type: [pointSchema], required: true },
    startedAt: { type: String, required: true },
    endedAt: { type: String, required: true },
    anchor: { type: anchorSchema, required: true },
    erasedAnchor: { type: anchorSchema, default: undefined },
    erasedAt: String,
  },
  { _id: false },
)

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
  narrateInputHash: String,
  attribution: { type: Schema.Types.Mixed, default: undefined },
  manuallyEdited: { type: Boolean, default: undefined },
  drawings: { type: [strokeSchema], default: undefined },
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
  drawings: doc.drawings,
})
