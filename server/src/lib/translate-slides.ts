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
 *
 * Because the cache decides what is paid for, it also decides what is metered:
 * the owner's allowance is checked and charged here, on the miss path only
 * (BILL-3/BILL-4 — see `billing/translation-usage.ts` for which pool pays).
 */
import { createHash } from 'node:crypto'
import type { Types } from 'mongoose'
import type {
  Locale,
  SlideTranslationEntry,
  SlotValue,
  TranslationProvider,
} from '@slide-machine/shared'
import { isTranslatableSlot } from '@slide-machine/shared'
import {
  htmlToMarkdown,
  markdownToHtml,
  restoreLinkHrefs,
} from './markdown-html'
import { slotsOf, remapSlots, type LegacyContent } from './slide-slots'
import { registry } from '../providers/registry'
import {
  assertTranslationCapacity,
  recordCachedTranslation,
  recordTranslationUsage,
  type TranslationBilling,
} from '../billing/translation-usage'
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

/** The slide content translated viewing covers. The spoken transcript is not
 * part of it: narration is translated on demand, when someone actually listens
 * (PLAY-3 — see `translate-narration.ts`). */
export interface TranslatableSlide extends LegacyContent {
  id: string
  /** Absent on slides written before the slot map; derived from the fields. */
  slots?: Record<string, SlotValue> | null
}

/** The slots of a slide that translated viewing actually covers, by name. */
const translatableSlotsOf = (slide: TranslatableSlide): [string, SlotValue][] =>
  Object.entries(slotsOf(slide))
    .filter(([, value]) => isTranslatableSlot(value))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * Bumped when the conversion or segmentation changes in a way that makes
 * existing cache entries wrong. Every hash carries it, so a bump invalidates
 * the whole cache generation without a migration — the same trick the TTS
 * cache key uses.
 */
const HASH_VERSION = 'v2'

/**
 * Fingerprint of the content an entry was translated from.
 *
 * Covers each translatable slot's NAME, KIND and text. Editing translated
 * content changes it; editing a picture, a code sample, the layout or the
 * transcript does not, so unrelated edits never spend a translation call.
 *
 * Names and kinds are in the hash because content moves between boxes — a
 * layout switch, a template update — without any of the words changing. A
 * hash over text alone would still match afterwards while the entry was keyed
 * to boxes the slide no longer uses, which is a cache that looks fresh and
 * reads wrong. With names in it, any move that is not carried across
 * explicitly simply invalidates and re-translates.
 */
export const slideSourceHash = (slide: TranslatableSlide): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        HASH_VERSION,
        translatableSlotsOf(slide).map(([name, value]) => [
          name,
          value.kind,
          translatableTextOf(value),
        ]),
      ]),
    )
    .digest('hex')

/** The words of a slot, in a shape that is stable to hash. */
const translatableTextOf = (value: SlotValue): unknown => {
  switch (value.kind) {
    case 'text':
    case 'preformatted':
      return value.value
    case 'bullets':
      return value.items
    case 'table':
      return [value.header ?? [], value.rows]
    default:
      return null
  }
}

/**
 * Preformatted text rides the same HTML batch as everything else, but as
 * escaped characters rather than converted Markdown — its spacing and its
 * punctuation are the author's, not markup to be interpreted.
 *
 * Its alignment still will not survive: translated words are not the same
 * length as the words they replace, so an ASCII table comes back readable but
 * no longer squared up. That is inherent to translating text whose layout is
 * made of spaces, and the alternative — refusing to translate it — was the
 * call that was made the other way.
 */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const unescapeHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&')

/** Where inside a slot one translatable string lives. */
type SegmentPath =
  | { at: 'value' }
  | { at: 'item'; index: number }
  | { at: 'header'; col: number }
  | { at: 'cell'; row: number; col: number }

/** One translatable string and where it belongs on its slide. */
interface Segment {
  slideId: string
  slot: string
  path: SegmentPath
  markdown: string
  /** Titles, captions, bullets and table cells render inline — no wrapping
   * paragraph. */
  inline: boolean
  /**
   * Preformatted text is sent as characters, not as Markdown. Running it
   * through the Markdown round trip would read its leading spaces as a code
   * block and its asterisks as emphasis, and hand back something the author
   * never wrote.
   */
  literal: boolean
}

/**
 * Splits a slide into the segments that need translating, skipping blanks.
 *
 * Walks the slot map rather than a fixed field list, so a layout an author
 * built translates whatever prose boxes it declares, under whatever names it
 * gave them. Kinds that are not prose never reach here — `translatableSlotsOf`
 * has already dropped them.
 */
const segmentsOf = (slide: TranslatableSlide): Segment[] => {
  const segments: Segment[] = []
  const push = (
    slot: string,
    path: SegmentPath,
    markdown: string | undefined,
    inline: boolean,
    literal = false,
  ): void => {
    if (markdown?.trim())
      segments.push({
        slideId: slide.id,
        slot,
        path,
        markdown,
        inline,
        literal,
      })
  }
  for (const [name, value] of translatableSlotsOf(slide)) {
    switch (value.kind) {
      case 'text':
        // A body reads as a block, a title or caption as one line. Multi-line
        // text is the only thing that wants a wrapping paragraph.
        push(name, { at: 'value' }, value.value, !value.value.includes('\n'))
        break
      case 'preformatted':
        push(name, { at: 'value' }, value.value, false, true)
        break
      case 'bullets':
        value.items.forEach((item, index) =>
          push(name, { at: 'item', index }, item, true),
        )
        break
      case 'table':
        value.header?.forEach((cell, col) =>
          push(name, { at: 'header', col }, cell, true),
        )
        value.rows.forEach((row, rowIndex) =>
          row.forEach((cell, col) =>
            push(name, { at: 'cell', row: rowIndex, col }, cell, true),
          ),
        )
        break
    }
  }
  return segments
}

/**
 * Rebuilds one slide's cache entry from its translated segments.
 *
 * Lists and tables are seeded from the source before translated strings are
 * written into them, so a cell or bullet the translator returned nothing for
 * falls back to the author's words rather than collapsing the shape.
 *
 * `previous` is the cached entry this one replaces, and it is here for one
 * reason: content and narration are fingerprinted independently (PLAY-3), so
 * neither pipeline may erase the other's work. This function rebuilds the slots
 * from scratch and the caller writes `perSlide` wholesale, so a translated
 * narration would be lost every time a slide's text was edited unless it is
 * carried across. Copied field by field rather than spread, because a cached
 * entry is a Mongoose subdocument and not a plain object.
 */
const entryOf = (
  slide: TranslatableSlide,
  translated: Map<Segment, string>,
  previous?: SlideTranslationEntry,
): SlideTranslationEntry => {
  const slots = slotsOf(slide)
  const entry: SlideTranslationEntry = {
    slots: {},
    sourceHash: slideSourceHash(slide),
    ...(previous?.narration !== undefined
      ? { narration: previous.narration }
      : {}),
    ...(previous?.narrationHash !== undefined
      ? { narrationHash: previous.narrationHash }
      : {}),
  }
  for (const [segment, text] of translated) {
    if (segment.slideId !== slide.id) continue
    const source = slots[segment.slot]
    if (!source) continue
    const path = segment.path
    if (
      path.at === 'value' &&
      (source.kind === 'text' || source.kind === 'preformatted')
    ) {
      entry.slots[segment.slot] = { kind: source.kind, value: text }
      continue
    }
    if (path.at === 'item' && source.kind === 'bullets') {
      const current = entry.slots[segment.slot]
      const items =
        current?.kind === 'bullets' ? current.items : [...source.items]
      items[path.index] = text
      entry.slots[segment.slot] = { kind: 'bullets', items }
      continue
    }
    if (source.kind === 'table' && path.at !== 'value' && path.at !== 'item') {
      const current = entry.slots[segment.slot]
      const table =
        current?.kind === 'table'
          ? current
          : {
              kind: 'table' as const,
              ...(source.header ? { header: [...source.header] } : {}),
              rows: source.rows.map(row => [...row]),
            }
      if (path.at === 'header' && table.header) table.header[path.col] = text
      if (path.at === 'cell') {
        const row = table.rows[path.row]
        if (row) row[path.col] = text
      }
      entry.slots[segment.slot] = table
    }
  }
  return entry
}

/**
 * Carries a slide's cached translations across a move between boxes.
 *
 * Content moves without changing — a per-slide layout switch (GEN-9), a
 * template update (TMPL-11) — and the words are the same words afterwards,
 * just under different slot names. Because the hash covers those names, doing
 * nothing here would leave every locale looking stale and re-translating text
 * the owner has already paid for (BILL-3). Applying the same pairing the
 * content followed, and restamping the hash from the slide as it now stands,
 * keeps what was already bought.
 *
 * Two things make this safe rather than merely cheap:
 *
 *   - It refuses entries that were **already** stale before the move. Their
 *     hash will not match `before`, and restamping one would pin a fresh hash
 *     onto a translation of text that has since been edited — wrong words,
 *     shown indefinitely. Those are left to re-translate normally.
 *   - It copies rather than moves, mirroring `remapSlots`, so switching back
 *     to the old layout finds its translation still there.
 *
 * `before` is the slide as it was when the entry was made — the caller has it
 * in hand, since it is the same map it just remapped.
 */
export const remapSlideTranslations = async (
  deckId: Types.ObjectId,
  slideId: string,
  pairs: Record<string, string>,
  before: TranslatableSlide,
): Promise<void> => {
  const moves = Object.entries(pairs).filter(([from, to]) => from !== to)
  if (!moves.length) return

  const beforeHash = slideSourceHash(before)
  const after: TranslatableSlide = {
    id: before.id,
    slots: remapSlots(slotsOf(before), pairs),
  }
  const afterHash = slideSourceHash(after)
  // Nothing translatable actually moved (the pairs only touched pictures or
  // code, say), so every entry is still correct as it stands.
  if (beforeHash === afterHash) return

  const docs = await SlideTranslationModel.find({ deckId })
  for (const doc of docs) {
    const entry = doc.perSlide?.get(slideId)
    if (!entry || entry.sourceHash !== beforeHash) continue
    const slots = { ...(entry.slots ?? {}) }
    for (const [from, to] of moves) {
      const value = entry.slots?.[from]
      if (value !== undefined) slots[to] = value
    }
    // Narration is not slot-keyed — a layout switch moves boxes, it does not
    // change what the lecturer said — so it rides across untouched (PLAY-3).
    doc.perSlide.set(slideId, {
      slots,
      sourceHash: afterHash,
      ...(entry.narration !== undefined ? { narration: entry.narration } : {}),
      ...(entry.narrationHash !== undefined
        ? { narrationHash: entry.narrationHash }
        : {}),
    })
    doc.markModified('perSlide')
    await doc.save()
  }
}

/**
 * Ensures the deck's cache entry for `target` is current, translating only
 * what is missing or stale, and returns the per-slide translations.
 *
 * Slides that have since been deleted are dropped from the cache on the way
 * through, so a long-lived entry cannot grow orphans.
 *
 * `billing` names who pays and out of which pool (BILL-3). It is optional
 * because not every translation has an account behind it — a deck whose owner
 * has been deleted, or a test — and because metering must never be the reason
 * a caller cannot use this. When it is supplied, this function is the only
 * place that knows whether the provider was actually called, which is why both
 * the cap check and the counting happen here rather than at the call sites.
 */
export const translateSlides = async (
  deckId: Types.ObjectId,
  slides: TranslatableSlide[],
  source: Locale,
  target: Locale,
  billing?: TranslationBilling,
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
  /** Whether anything reached the provider — what separates a charge from a
   * zero-cost record. Stale slides with no words in them do not count. */
  let translated = false
  if (stale.length) {
    const segments = stale.flatMap(segmentsOf)
    const translatedBySegment = new Map<Segment, string>()
    if (segments.length) {
      const sourceHtml = segments.map(s =>
        s.literal
          ? escapeHtml(s.markdown)
          : markdownToHtml(s.markdown, { inline: s.inline }),
      )
      // Checked here, at the last moment before the call that spends money, and
      // only when there is something to spend it on. Throws → 402 (BILL-4).
      if (billing)
        await assertTranslationCapacity(billing, { localeIsNew: !existing })
      const provider = registry.get<TranslationProvider>('translation')
      const translatedHtml = await provider.translate({
        texts: sourceHtml,
        source,
        target,
        format: 'html',
      })
      translated = true
      // After the fact, like every other metric: only a call that returned is
      // charged, and it is charged for what was really submitted.
      if (billing) {
        await recordTranslationUsage(billing, {
          characters: sourceHtml.reduce(
            (total, html) => total + html.length,
            0,
          ),
          localeIsNew: !existing,
        })
      }
      segments.forEach((segment, i) => {
        const repaired = restoreLinkHrefs(
          sourceHtml[i] ?? '',
          translatedHtml[i] ?? '',
        )
        // A translator that returns nothing must not blank a slide — fall
        // back to the words the author actually wrote.
        translatedBySegment.set(
          segment,
          (segment.literal
            ? unescapeHtml(repaired)
            : htmlToMarkdown(repaired)) || segment.markdown,
        )
      })
    }
    for (const slide of stale)
      fresh.set(
        slide.id,
        entryOf(slide, translatedBySegment, cached.get(slide.id)),
      )
  }

  // Merge: freshly translated entries win, live slides keep their cached
  // entry, and slides that no longer exist fall out entirely.
  const merged = new Map<string, SlideTranslationEntry>()
  for (const slide of slides) {
    const entry = fresh.get(slide.id) ?? cached.get(slide.id)
    if (entry) merged.set(slide.id, entry)
  }

  if (stale.length || !existing) {
    // Written wholesale, which leaves a narrow race with a narration write
    // (PLAY-3) landing between the read above and this line: a first translated
    // *play* concurrent with a content re-translation of the same deck. It
    // costs one short `format: 'text'` call on the next play, which re-fills
    // it, so it is left alone rather than reworked into per-slide `$set` paths.
    await SlideTranslationModel.updateOne(
      { deckId, locale: target },
      { $set: { perSlide: merged } satisfies Partial<SlideTranslationDb> },
      { upsert: true },
    )
  }
  // Served from the cache. Recorded at zero so the read still counts towards
  // how many people this deck reached (BILL-3/BILL-7), without spending an
  // allowance on words nobody re-translated.
  if (billing && !translated) await recordCachedTranslation(billing)
  return Object.fromEntries(merged)
}
