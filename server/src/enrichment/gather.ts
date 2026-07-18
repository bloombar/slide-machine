/**
 * Per-phrase candidate gathering (IMG-1). The image sources treat a
 * multi-term query CONJUNCTIVELY, so concatenating a slide's keyword phrases
 * into one query — "hobby horse hobby horsing competition toy horse on
 * stick" — matches nothing, while each phrase alone ("hobby horse") matches
 * plenty. So we query each phrase separately and pool the results, rather
 * than joining them into a single over-specified query.
 */
import { searchWikimedia } from './wikimedia'
import { searchOpenverse } from './openverse'
import { searchFlickr } from './flickr'
import type { ImageCandidate } from './types'

/**
 * Most keyword phrases we fan out on. Each phrase fires all three sources,
 * so this bounds request volume (phrases × 3). It covers the full set the
 * generator emits (deriveImageKeywords / imageGuidance cap at 6), so the
 * default "search all the AI phrases" is honored; a longer hand-typed list
 * has its tail trimmed. Phrases are ordered most-relevant-first.
 */
const MAX_QUERY_PHRASES = 6

/**
 * Queries every source once per keyword phrase and returns the pooled,
 * URL-deduplicated candidates. Any source (or phrase) failing collapses to
 * fewer results, never an error (IMG-2). Ranking is left to the caller.
 */
export const gatherCandidates = async (
  phrases: string[],
  timeoutMs: number,
): Promise<ImageCandidate[]> => {
  const queries = phrases
    .map(p => p.trim())
    .filter(Boolean)
    .slice(0, MAX_QUERY_PHRASES)
  if (!queries.length) return []

  const settled = await Promise.allSettled(
    queries.flatMap(q => [
      searchWikimedia([q], AbortSignal.timeout(timeoutMs)),
      searchOpenverse([q], AbortSignal.timeout(timeoutMs)),
      searchFlickr([q], AbortSignal.timeout(timeoutMs)),
    ]),
  )

  // Pool in query order, keeping the first occurrence of each URL so a
  // candidate found under several phrases is not duplicated.
  const seen = new Set<string>()
  const pool: ImageCandidate[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const candidate of result.value) {
      if (seen.has(candidate.url)) continue
      seen.add(candidate.url)
      pool.push(candidate)
    }
  }
  return pool
}
