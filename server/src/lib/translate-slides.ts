/**
 * Slide-content translation for post-lecture translated viewing (SHARE-2).
 *
 * Translating a deck is a read-through cache: only slides whose text has
 * changed since they were last translated are sent to the provider, and the
 * result is merged into the deck's cache entry for that locale. A viewer who
 * opens a deck in French after someone else already did spends nothing, and
 * editing one slide costs one slide's translation rather than the deck's.
 *
 * Every field makes the same round trip — restricted Markdown to HTML, through
 * the translator in HTML mode so inline formatting travels with the words,
 * then back to Markdown, which is the one format the viewer, the exports, and
 * the editor all read. Nothing here writes to the slides themselves: the
 * authored content stays authoritative, and the translation is a layer over it.
 */
import { createHash } from 'node:crypto'
import type { Types } from 'mongoose'
import type {
  Locale,
  SlideTranslationEntry,
  TranslationProvider,
} from '@slide-machine/shared'
import {
  htmlToMarkdown,
  markdownToHtml,
  restoreLinkHrefs,
} from './markdown-html'
import { registry } from '../providers/registry'
import { env } from '../config/env'
import {
  SlideTranslationModel,
  type SlideTranslationDb,
} from '../models/slide-translation'

/**
 * Whether translated viewing is usable: a provider is selected and (for
 * Google) a key is set. Drives both the client feature flag and the route's
 * guard, so the switcher is never offered for a call that can only fail.
 */
export const translationEnabled = (): boolean => {
  const provider = env.TRANSLATION_PROVIDER
  if (provider === 'none') return false
  if (provider === 'google-cloud')
    return Boolean(env.GOOGLE_CLOUD_TRANSLATION_KEY)
  return true
}

/** The slide fields translated viewing covers — content only, never the
 * spoken transcript (narration stays in the lecture's own language). */
export interface TranslatableSlide {
  id: string
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
}

/**
 * Bumped when the conversion or segmentation changes in a way that makes
 * existing cache entries wrong. Every hash carries it, so a bump invalidates
 * the whole cache generation without a migration — the same trick the TTS
 * cache key uses.
 */
const HASH_VERSION = 'v1'

/**
 * Fingerprint of the source text an entry was translated from. Editing any
 * translated field changes it; editing the image, layout, or transcript does
 * not, so unrelated edits never spend a translation call.
 */
export const slideSourceHash = (slide: TranslatableSlide): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        HASH_VERSION,
        slide.title ?? '',
        slide.body ?? '',
        slide.bullets ?? [],
        slide.caption ?? '',
      ]),
    )
    .digest('hex')

/** One translatable string and where it belongs on its slide. */
interface Segment {
  slideId: string
  field: 'title' | 'body' | 'bullets' | 'caption'
  /** Position within `bullets`; absent for the single-value fields. */
  index?: number
  markdown: string
  /** Titles, captions and bullets render inline — no wrapping paragraph. */
  inline: boolean
}

/** Splits a slide into the segments that need translating, skipping blanks. */
const segmentsOf = (slide: TranslatableSlide): Segment[] => {
  const segments: Segment[] = []
  const push = (
    field: Segment['field'],
    markdown: string | undefined,
    inline: boolean,
    index?: number,
  ): void => {
    if (markdown?.trim())
      segments.push({ slideId: slide.id, field, markdown, inline, index })
  }
  push('title', slide.title, true)
  push('body', slide.body, false)
  slide.bullets?.forEach((bullet, i) => push('bullets', bullet, true, i))
  push('caption', slide.caption, true)
  return segments
}

/** Rebuilds one slide's cache entry from its translated segments. */
const entryOf = (
  slide: TranslatableSlide,
  translated: Map<Segment, string>,
): SlideTranslationEntry => {
  const entry: SlideTranslationEntry = { sourceHash: slideSourceHash(slide) }
  for (const [segment, markdown] of translated) {
    if (segment.slideId !== slide.id) continue
    if (segment.field === 'bullets') {
      // Keep the original list length and order: an untranslated bullet
      // falls back to its source rather than collapsing the list.
      entry.bullets ??= [...(slide.bullets ?? [])]
      entry.bullets[segment.index!] = markdown
    } else {
      entry[segment.field] = markdown
    }
  }
  return entry
}

/**
 * Ensures the deck's cache entry for `target` is current, translating only
 * what is missing or stale, and returns the per-slide translations.
 *
 * Slides that have since been deleted are dropped from the cache on the way
 * through, so a long-lived entry cannot grow orphans.
 */
export const translateSlides = async (
  deckId: Types.ObjectId,
  slides: TranslatableSlide[],
  source: Locale,
  target: Locale,
): Promise<Record<string, SlideTranslationEntry>> => {
  const existing = await SlideTranslationModel.findOne({
    deckId,
    locale: target,
  })
  const cached = existing?.perSlide ?? new Map<string, SlideTranslationEntry>()

  // Stale = never translated, or translated from text that has since changed.
  const stale = slides.filter(
    slide => cached.get(slide.id)?.sourceHash !== slideSourceHash(slide),
  )

  const fresh = new Map<string, SlideTranslationEntry>()
  if (stale.length) {
    const segments = stale.flatMap(segmentsOf)
    const translatedBySegment = new Map<Segment, string>()
    if (segments.length) {
      const sourceHtml = segments.map(s =>
        markdownToHtml(s.markdown, { inline: s.inline }),
      )
      const provider = registry.get<TranslationProvider>('translation')
      const translatedHtml = await provider.translate({
        texts: sourceHtml,
        source,
        target,
        format: 'html',
      })
      segments.forEach((segment, i) => {
        const repaired = restoreLinkHrefs(
          sourceHtml[i] ?? '',
          translatedHtml[i] ?? '',
        )
        // A translator that returns nothing must not blank a slide — fall
        // back to the words the author actually wrote.
        translatedBySegment.set(
          segment,
          htmlToMarkdown(repaired) || segment.markdown,
        )
      })
    }
    for (const slide of stale)
      fresh.set(slide.id, entryOf(slide, translatedBySegment))
  }

  // Merge: freshly translated entries win, live slides keep their cached
  // entry, and slides that no longer exist fall out entirely.
  const merged = new Map<string, SlideTranslationEntry>()
  for (const slide of slides) {
    const entry = fresh.get(slide.id) ?? cached.get(slide.id)
    if (entry) merged.set(slide.id, entry)
  }

  if (stale.length || !existing) {
    await SlideTranslationModel.updateOne(
      { deckId, locale: target },
      { $set: { perSlide: merged } satisfies Partial<SlideTranslationDb> },
      { upsert: true },
    )
  }
  return Object.fromEntries(merged)
}
