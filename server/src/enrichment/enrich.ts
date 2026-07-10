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
import type { EnrichedImage } from './types'

/** Hard cap per source; the slowest source bounds total wall-clock. */
const SOURCE_TIMEOUT_MS = 3000

/** Queries all sources in parallel and picks one winner, or null. */
export const enrichImage = async (
  keywords: string[],
): Promise<EnrichedImage | null> => {
  if (!keywords.length) return null

  const results = await Promise.allSettled([
    searchWikimedia(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
    searchOpenverse(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
    searchFlickr(keywords, AbortSignal.timeout(SOURCE_TIMEOUT_MS)),
  ])
  const pool = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []))

  const best = pickBest(pool, keywords)
  if (!best) return null
  return { url: best.url, source: best.source, attribution: best.attribution }
}

/**
 * Fire-and-forget enrichment for a persisted slide. Never throws; never
 * overwrites an existing image (IMG-3 stability). The client discovers
 * the image by re-reading the slide.
 */
export const enrichSlideImage = async (
  slideId: string,
  keywords: string[],
): Promise<void> => {
  try {
    const image = await enrichImage(keywords)
    if (!image) return
    await SlideModel.updateOne(
      { _id: slideId, imageRef: { $exists: false } },
      {
        imageRef: image.url,
        imageSource: 'stock',
        attribution: image.attribution,
      },
    )
  } catch (error) {
    // Enrichment must never surface as an error anywhere (IMG-2)
    console.warn('Image enrichment skipped:', error)
  }
}
