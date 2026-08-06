/**
 * Slide model (SPEC §15 / GEN-6/GEN-7). layoutType is AI-chosen from the
 * template's descriptors; imageSource records provenance (IMG-4).
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import {
  type ImageAttribution,
  type Slide,
  type SlotValue,
  type Stroke,
  type StrokeAnchor,
  type StrokePoint,
} from '@slide-machine/shared'
import { softDeletePlugin } from './plugins/soft-delete'
import { foldLegacy, legacyFrom, slotsOf } from '../lib/slide-slots'

export interface SlideDb extends Omit<Slide, 'id' | 'deckId' | 'slots'> {
  deckId: Types.ObjectId
  /** Absent on documents written before the slot map; synthesized on read. */
  slots?: Record<string, SlotValue>
  /** Hash of the inputs that produced the current narration (role turns +
   * level + language). Lets a diarized slide skip re-narration when nothing
   * changed, so repeated Refines are idempotent. Server-internal — not in the
   * Slide DTO. */
  narrateInputHash?: string
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
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
  // No enum: a template's author names its layouts (TMPL-9), and the actions
  // that set this check the slide's own template for the name.
  layoutType: { type: String, required: true },
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
  // The slide's content, keyed by the slot names its layout declares. Loose
  // on purpose: the slot set is data a template author writes, not a shape
  // this schema can know ahead of time. The five fields above are kept in
  // step with it below, so the text index and every existing reader still
  // work (docs/plans/extensible-templates-plan.md).
  slots: { type: Schema.Types.Mixed, default: undefined },
})

/**
 * Keeps the map and the conventional fields in step, in ONE place.
 *
 * The map is the store. Code that still assigns `slide.title` is folded into
 * it here rather than being rewritten at every call site; the fields are then
 * written back from the map so the `slide_text` index keeps indexing real
 * content. Without this the two would drift.
 */
const LEGACY_FIELDS = [
  'title',
  'body',
  'bullets',
  'caption',
  'imageRef',
  'imageSource',
  'imageKeywords',
  'attribution',
] as const

slideSchema.pre('save', function () {
  const folded = foldLegacy(slotsOf(this), this, field =>
    this.isModified(field),
  )
  this.slots = folded
  this.markModified('slots')
  const derived = legacyFrom(folded)
  const target = this as unknown as Record<string, unknown>
  for (const field of LEGACY_FIELDS) target[field] = derived[field]
})

slideSchema.index({ deckId: 1, index: 1 })
// Full-text search over what is actually on a slide (SOC-2 "content"). Slides
// are the largest collection by far, so scanning them per keystroke is the
// first thing to hurt; this index makes whole-word queries indexed lookups.
slideSchema.index(
  { title: 'text', body: 'text', bullets: 'text', caption: 'text' },
  {
    weights: { title: 10, body: 3, bullets: 3, caption: 1 },
    name: 'slide_text',
  },
)

slideSchema.plugin(softDeletePlugin)

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
  // Documents written before the map existed are normalized on read, so
  // every consumer sees one shape (cf. toAttributionDto).
  slots: slotsOf(doc),
})
