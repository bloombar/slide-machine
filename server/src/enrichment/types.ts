/**
 * Image-enrichment types (IMG-1/IMG-2). Candidates come from any source;
 * scoring picks one winner or none — a missing image is preferable to a
 * misleading one (IMG-3).
 */
export type EnrichmentSource = 'seeded' | 'wikimedia' | 'openverse' | 'flickr'

export interface ImageCandidate {
  url: string
  title: string
  tags: string[]
  source: EnrichmentSource
  width?: number
  height?: number
  license?: string
  attribution?: string
  /** The provider's page for this image, shown as "Source" (IMG-5). */
  sourceUrl?: string
}

/** The selected image, ready to persist onto a slide. */
export interface EnrichedImage {
  url: string
  source: EnrichmentSource
  /** Credit line (author + provider), for the attribution dialog (IMG-5). */
  attribution?: string
  /** License name, e.g. "CC BY 4.0" (IMG-5). */
  license?: string
  /** The provider's page for this image, shown as "Source" (IMG-5). */
  sourceUrl?: string
}
