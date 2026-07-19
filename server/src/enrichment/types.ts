/**
 * Image-enrichment types (IMG-1/IMG-2). Candidates come from any source;
 * scoring picks one winner or none — a missing image is preferable to a
 * misleading one (IMG-3). Every candidate carries a source-agnostic
 * `ImageAttribution` credit (IMG-5): each provider maps its own metadata
 * onto that one shape so the stored result is consistent regardless of
 * where the image came from.
 */
import type { ImageAttribution } from '@slide-machine/shared'

export type EnrichmentSource = 'seeded' | 'wikimedia' | 'openverse' | 'flickr'

export interface ImageCandidate {
  url: string
  /** Work title — a scoring input (keyword overlap) and TASL "T". */
  title: string
  /** Keyword tags — a scoring input only (categories/tags/keywords). */
  tags: string[]
  source: EnrichmentSource
  width?: number
  height?: number
  /** Source-agnostic credit, ready to persist onto the slide (IMG-5). */
  attribution?: ImageAttribution
}

/** The selected image, ready to persist onto a slide. A `caption` is present
 * only when the AI re-rank produced one to match the chosen image (IMG-1). */
export interface EnrichedImage {
  url: string
  source: EnrichmentSource
  attribution?: ImageAttribution
  caption?: string
}

/**
 * Slide context handed to the AI re-rank so the model can (a) pick the
 * candidate that best fits THIS slide/lecture and (b) write a caption that
 * matches the chosen image. All fields optional except the layout — the more
 * context, the better the choice.
 */
export interface SlideImageContext {
  title?: string
  body?: string
  bullets?: string[]
  /** The model's current caption (rewritten to match the chosen image). */
  caption?: string
  imageKeywords?: string[]
  layoutType: string
  /** Caption character budget from the template slot spec (e.g. 80). */
  captionMaxChars?: number
  /** Deck/project lecture background, for grounding the choice. */
  seedContext?: string
  /** 'replace' overwrites the caption (fresh slide); 'fill' only sets it when
   * empty (manual layout switch — never clobber a user's edit). */
  captionMode: 'replace' | 'fill'
}
