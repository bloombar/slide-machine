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

/** The selected image, ready to persist onto a slide. */
export interface EnrichedImage {
  url: string
  source: EnrichmentSource
  attribution?: ImageAttribution
}
