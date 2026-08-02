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
import { env } from '../config/env'
import { meterUsage } from '../billing/usage-context'
import type { ImageCandidate } from './types'

/**
 * Queries every source once per keyword phrase and returns the pooled,
 * URL-deduplicated candidates. Any source (or phrase) failing collapses to
 * fewer results, never an error (IMG-2). Ranking is left to the caller.
 *
 * This is also where `imageLookups` is metered (BILL-3): one unit per call,
 * not one per outbound HTTP request. The fan-out here is a tuning decision —
 * three sources times up to `IMAGE_MAX_QUERY_PHRASES` phrases — and a metric
 * that moved every time that was retuned would be unreadable to the person
 * whose allowance it is. One lookup means "one slide image resolved", which is
 * the unit a user recognises.
 */
export const gatherCandidates = async (
  phrases: string[],
  timeoutMs: number,
): Promise<ImageCandidate[]> => {
  // Cap the fan-out (each phrase fires all three sources) at the configured
  // max — it covers the full set the generator emits, ordered most-relevant
  // first, so a longer hand-typed list just has its tail trimmed.
  const queries = phrases
    .map(p => p.trim())
    .filter(Boolean)
    .slice(0, env.IMAGE_MAX_QUERY_PHRASES)
  if (!queries.length) return []

  // Metered before the fan-out: the searches are what cost, so an attempt that
  // happens to find nothing still spent the lookup.
  await meterUsage('imageLookups', 1)

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
