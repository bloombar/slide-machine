/**
 * Candidate scoring (IMG-1/IMG-3): pooled candidates from all sources
 * are ranked by keyword relevance weighted by a source-trust prior, with
 * a hard threshold — below it, no image is used at all. A missing image
 * is preferable to a misleading one.
 */
import type { EnrichmentSource, ImageCandidate } from './types'

/** The instructor's own material beats any web source (IMG-1); among
 * web sources, Wikimedia ranks highest for named entities/concepts and
 * Flickr is prettiest but noisiest. */
const SOURCE_PRIOR: Record<EnrichmentSource, number> = {
  seeded: 1.2,
  wikimedia: 1.0,
  openverse: 0.9,
  flickr: 0.85,
}

/** Candidates below this relevance score are rejected outright. */
export const SCORE_THRESHOLD = 0.3

/** Tiny thumbnails don't survive a projector. */
const MIN_WIDTH = 320

const normalize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Fraction of keywords found in the candidate's title + tags, weighted by source. */
export const scoreCandidate = (
  candidate: ImageCandidate,
  keywords: string[],
): number => {
  if (!keywords.length) return 0
  const haystack = new Set(
    normalize([candidate.title, ...candidate.tags].join(' ')),
  )
  const matched = keywords.filter(k =>
    normalize(k).every(word => haystack.has(word)),
  )
  const overlap = matched.length / keywords.length
  if (overlap === 0) return 0 // size can't rescue an irrelevant image
  const sizeBonus = (candidate.width ?? 0) >= 600 ? 0.05 : 0
  return overlap * SOURCE_PRIOR[candidate.source] + sizeBonus
}

/** The best candidate above the threshold, or null (graceful fallback). */
export const pickBest = (
  candidates: ImageCandidate[],
  keywords: string[],
): ImageCandidate | null => {
  let best: ImageCandidate | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    if ((candidate.width ?? MIN_WIDTH) < MIN_WIDTH) continue
    const score = scoreCandidate(candidate, keywords)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return bestScore >= SCORE_THRESHOLD ? best : null
}
