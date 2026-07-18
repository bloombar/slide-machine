/**
 * Enrichment orchestrator (IMG-1/IMG-2). All sources are queried in
 * parallel with a hard per-source timeout; failures collapse to empty
 * result sets. Runs strictly OFF the phrase→slide critical path: the
 * SlideEvent has already been returned when this starts, and the result
 * (if any) is persisted for the client to pick up.
 */
import { SlideModel } from '../models/slide'
import { searchWikimedia } from './wikimedia'
import { searchOpenverse } from './openverse'
import { searchFlickr } from './flickr'
import { pickBest } from './scoring'
import type { EnrichedImage, ImageCandidate } from './types'

/** Hard cap per source; the slowest source bounds total wall-clock. */
const SOURCE_TIMEOUT_MS = 3000

/** Queries all sources in parallel and picks one winner, or null.
 * Seeded candidates (the instructor's own uploads, SEED-2) join the
 * pool from the caller and carry the highest source prior. */
export const enrichImage = async (
  keywords: string[],
  seeded: ImageCandidate[] = [],
): Promise<EnrichedImage | null> => {
  if (!keywords.length) return null

  const results = await Promise.allSettled([
    searchWikimedia(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
    searchOpenverse(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
    searchFlickr(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
  ])
  const pool = [
    ...seeded,
    ...results.flatMap(r => (r.status === 'fulfilled' ? r.value : [])),
  ]

  const best = pickBest(pool, keywords)
  if (!best) return null
  return { url: best.url, source: best.source, attribution: best.attribution }
}

/** Drops undefined fields so a partially-populated credit doesn't persist
 * a subdocument full of null keys; returns undefined when nothing is set. */
const compactAttribution = (
  attribution: EnrichedImage['attribution'],
): EnrichedImage['attribution'] => {
  if (!attribution) return undefined
  const entries = Object.entries(attribution).filter(
    ([, value]) => value != null && value !== '',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

/**
 * Fire-and-forget enrichment for a persisted slide. Never throws; never
 * overwrites an existing image (IMG-3 stability). The client discovers
 * the image by re-reading the slide.
 */
export const enrichSlideImage = async (
  slideId: string,
  keywords: string[],
  seeded: ImageCandidate[] = [],
): Promise<void> => {
  try {
    const image = await enrichImage(keywords, seeded)
    if (!image) return
    // Fill only a slide that has no image yet. "No image" means the field
    // is absent (never set) OR an empty string — the latter is a common,
    // documented state (an image the user removed, or a placeholder left by
    // a layout switch). Matching only { $exists: false } silently dropped
    // the sourced image whenever imageRef was ''. A real URL is still never
    // overwritten (IMG-3 stability).
    await SlideModel.updateOne(
      { _id: slideId, imageRef: { $in: [null, ''] } },
      {
        imageRef: image.url,
        imageSource: image.source === 'seeded' ? 'seeded' : 'stock',
        attribution: compactAttribution(image.attribution),
      },
    )
  } catch (error) {
    // Enrichment must never surface as an error anywhere (IMG-2)
    console.warn('Image enrichment skipped:', error)
  }
}
