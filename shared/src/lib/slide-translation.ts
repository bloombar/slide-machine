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
import type { SlideTranslationEntry } from '../types/deck'
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
}

export const overlaySlideTranslation = <T extends TranslatableSlideText>(
  slide: T,
  entry: SlideTranslationEntry | undefined,
): T => {
  if (!entry) return slide
  return {
    ...slide,
    title: entry.title ?? slide.title,
    body: entry.body ?? slide.body,
    bullets: entry.bullets ?? slide.bullets,
    caption: entry.caption ?? slide.caption,
  }
}
