/**
 * Image-enrichment types (IMG-1/IMG-2). Candidates come from any source;
 * scoring picks one winner or none — a missing image is preferable to a
 * misleading one (IMG-3).
 */
export type EnrichmentSource = 'wikimedia' | 'openverse' | 'flickr'

export interface ImageCandidate {
  url: string
  title: string
  tags: string[]
  source: EnrichmentSource
  width?: number
  height?: number
  license?: string
  attribution?: string
}

/** The selected image, ready to persist onto a slide. */
export interface EnrichedImage {
  url: string
  source: EnrichmentSource
  attribution?: string
}
