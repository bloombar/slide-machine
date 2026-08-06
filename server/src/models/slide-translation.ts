/**
 * SlideTranslation model (SHARE-2) — the on-demand cache of a deck's slide
 * content in one locale, so a second viewer in French never re-spends the
 * paid API. One document per deck + locale, in its own collection rather than
 * on the deck: five locales of full slide text would push a long lecture at
 * the 16 MB document cap, the same reason transcript segments live apart.
 *
 * Deliberately NOT soft-deleted, unlike its sibling collections. This is a
 * derived cache with no authored content in it — everything here can be
 * recomputed from slides that P-10 already retains — so the delete cascade
 * removes it outright. That also keeps an admin viewing a soft-deleted deck
 * (ADMIN-6) from colliding with a tombstoned row on the unique index.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import {
  LOCALES,
  type Locale,
  type SlideTranslation,
  type SlideTranslationEntry,
} from '@slide-machine/shared'

export interface SlideTranslationDb {
  deckId: Types.ObjectId
  locale: Locale
  perSlide: Map<string, SlideTranslationEntry>
  createdAt: Date
  updatedAt: Date
}

/**
 * One slide's translated slots; id-less, it is keyed by slide id above.
 *
 * `slots` is Mixed for the same reason a slide's own map is: the set of boxes
 * is data a template author writes, not a shape this schema can know ahead of
 * time (see models/slide.ts). Entries whose hash predates the slot map read as
 * stale and are simply re-translated, so no migration is needed to get here.
 */
const entrySchema = new Schema<SlideTranslationEntry>(
  {
    slots: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceHash: String,
  },
  { _id: false },
)

const slideTranslationSchema = new Schema<SlideTranslationDb>(
  {
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
    locale: { type: String, enum: LOCALES, required: true },
    // Keyed by slide id — safe as a Mongo key, which cannot contain dots.
    perSlide: { type: Map, of: entrySchema, default: () => new Map() },
  },
  { timestamps: true },
)

// One cache entry per deck + locale; the read path upserts against exactly
// this key, and the constraint keeps concurrent first views from racing in
// two copies.
slideTranslationSchema.index({ deckId: 1, locale: 1 }, { unique: true })

export const SlideTranslationModel = model<SlideTranslationDb>(
  'SlideTranslation',
  slideTranslationSchema,
)

export const toSlideTranslationDto = (
  doc: HydratedDocument<SlideTranslationDb>,
): SlideTranslation => ({
  id: doc._id.toString(),
  deckId: doc.deckId.toString(),
  locale: doc.locale,
  perSlide: Object.fromEntries(doc.perSlide ?? new Map()),
  createdAt: doc.createdAt.toISOString(),
})
