/**
 * Multi-candidate image search (EDIT-1). Where enrichImage picks a single
 * best image to auto-attach, this returns a ranked list of options for a
 * person to choose from when replacing a slide's picture. It queries the
 * same permitted sources (Wikimedia, Openverse, Flickr) and ranks them by
 * keyword relevance, but keeps several so the instructor can pick a better
 * fit. Any source failure collapses to fewer results, never an error (IMG-2).
 */
import { gatherCandidates } from './gather'
import { scoreCandidate } from './scoring'
import type { ImageCandidate } from './types'

/** Hard cap per source; the slowest source bounds total wall-clock. */
const SOURCE_TIMEOUT_MS = 4000

/** Tiny thumbnails don't survive a projector; drop them from the options. */
const MIN_WIDTH = 320

/**
 * Searches each keyword phrase, pools the results (deduplicated by URL),
 * and returns up to `limit` candidates ranked by keyword relevance. The
 * source APIs already match on each query, so every result is topically
 * related; the ranking just surfaces the closest fits first.
 */
export const searchImageCandidates = async (
  keywords: string[],
  limit = 12,
): Promise<ImageCandidate[]> => {
  if (!keywords.length) return []

  const pool = await gatherCandidates(keywords, SOURCE_TIMEOUT_MS)

  return pool
    .filter(c => (c.width ?? MIN_WIDTH) >= MIN_WIDTH)
    .map(c => ({ candidate: c, score: scoreCandidate(c, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.candidate)
}
