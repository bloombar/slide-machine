/**
 * Turns a slide's rendered content into clean, speakable plain text for the
 * TTS route. Slide text (title/body/bullets/caption) is restricted Markdown
 * (see client SlideMarkdown), so the markers are stripped before speech; the
 * stored transcript (`sourceTranscript`) is raw speech and needs no stripping.
 */

/** Removes the Markdown syntax slide text may contain, leaving prose. */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images ![alt](url) -> alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links [text](url) -> text
    .replace(/`([^`]*)`/g, '$1') // inline `code` -> code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // **bold** / __bold__ -> text
    .replace(/(\*|_)(.*?)\1/g, '$2') // *italic* / _italic_ -> text
    .replace(/^\s{0,3}(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, '') // headings/quotes/list markers
    .replace(/\s+/g, ' ')
    .trim()

/** Fields that make up a slide's spoken content, ordered as read aloud. */
export interface SpeakableSlide {
  title?: string | null
  body?: string | null
  bullets?: string[] | null
  caption?: string | null
}

/**
 * The slide's rendered content as one speakable string. Fields and bullets are
 * joined with sentence breaks so the synthesizer pauses naturally between them.
 */
export const slideContentText = (slide: SpeakableSlide): string =>
  [slide.title, slide.body, ...(slide.bullets ?? []), slide.caption]
    .filter((p): p is string => Boolean(p && p.trim()))
    .map(stripMarkdown)
    .filter(Boolean)
    .join('. ')
