/**
 * Laying a translation over a slide (SHARE-2). Shared by the viewer, which
 * overlays for display, and the export path, which overlays before rendering
 * a file — one implementation so a translated deck reads the same on screen
 * and in a PDF.
 *
 * The overlay is non-destructive by construction: it returns a copy and never
 * touches the stored slide. Fields the translation does not cover keep the
 * author's original, so a partial translation degrades to the source rather
 * than to blanks.
 */
import type { SlideTranslationEntry, SlotValue } from '../types/deck'
import type { Locale } from '../types/locale'

/**
 * The language a deck's content is authored in — what "Original" means for
 * it. Same cascade the rest of the app uses for a lecture's language: the
 * lecture's own setting, else its project's, else English.
 */
export const deckSourceLocale = (
  deckLanguage: Locale | undefined,
  projectLanguage: Locale | undefined,
): Locale => deckLanguage ?? projectLanguage ?? 'en'

/** The slide text translated viewing covers — content only, never narration. */
export interface TranslatableSlideText {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  /** The slot map, when the caller is a whole slide rather than a fragment. */
  slots?: Record<string, SlotValue>
}

/**
 * The slot map with the translated slots laid over it. The renderer draws
 * from the map, so a translation that only replaced the derived fields would
 * be invisible on screen.
 *
 * A translated slot is applied only where the slide still has a box of that
 * name holding that kind. Anything else — a box the layout dropped, or one
 * whose kind changed under a stale entry — keeps the author's content rather
 * than being overwritten with a translation of something else.
 */
const overlaySlots = (
  slots: Record<string, SlotValue> | undefined,
  entry: SlideTranslationEntry,
): Record<string, SlotValue> | undefined => {
  if (!slots) return slots
  const next = { ...slots }
  for (const [name, translated] of Object.entries(entry.slots ?? {})) {
    const original = slots[name]
    if (!original || original.kind !== translated.kind) continue
    if (translated.kind === 'table' && original.kind === 'table') {
      next[name] = {
        ...original,
        ...(translated.header ? { header: translated.header } : {}),
        rows: translated.rows,
      }
      continue
    }
    next[name] = { ...original, ...translated } as SlotValue
  }
  return next
}

/** The translated text of one slot, when it holds prose. */
const textAt = (
  entry: SlideTranslationEntry,
  name: string,
): string | undefined => {
  const value = entry.slots?.[name]
  return value && (value.kind === 'text' || value.kind === 'preformatted')
    ? value.value
    : undefined
}

/** The translated items of one slot, when it holds a list. */
const itemsAt = (
  entry: SlideTranslationEntry,
  name: string,
): string[] | undefined => {
  const value = entry.slots?.[name]
  return value?.kind === 'bullets' ? value.items : undefined
}

/**
 * Lays a translation over a slide.
 *
 * The slot map is the store, so that is what the overlay really replaces; the
 * five conventional fields are derived from it afterwards for the readers
 * still written against them, exactly the way `legacyFrom` derives them on
 * the server.
 */
export const overlaySlideTranslation = <T extends TranslatableSlideText>(
  slide: T,
  entry: SlideTranslationEntry | undefined,
): T => {
  if (!entry) return slide
  return {
    ...slide,
    title: textAt(entry, 'title') ?? slide.title,
    body: textAt(entry, 'body') ?? slide.body,
    bullets: itemsAt(entry, 'bullets') ?? slide.bullets,
    caption: textAt(entry, 'caption') ?? slide.caption,
    ...(slide.slots ? { slots: overlaySlots(slide.slots, entry) } : {}),
  }
}
