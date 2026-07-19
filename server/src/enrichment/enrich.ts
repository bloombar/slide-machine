/**
 * Enrichment orchestrator (IMG-1/IMG-2). All sources are queried in
 * parallel with a hard per-source timeout; failures collapse to empty
 * result sets. Runs strictly OFF the phrase→slide critical path: the
 * SlideEvent has already been returned when this starts, and the result
 * (if any) is persisted for the client to pick up.
 */
import { SlideModel } from '../models/slide'
import { env } from '../config/env'
import { gatherCandidates } from './gather'
import { pickBest, scoreCandidate } from './scoring'
import { rankAndCaption } from './ai-rank'
import type { EnrichedImage, ImageCandidate, SlideImageContext } from './types'

/** Hard cap per source; the slowest source bounds total wall-clock. */
const SOURCE_TIMEOUT_MS = 3000

/** Tiny thumbnails don't survive a projector; keep them out of the shortlist. */
const MIN_WIDTH = 320

/**
 * Searches each keyword phrase, pools the candidates, and picks one winner,
 * or null. When slide `context` is supplied, an AI re-rank chooses the
 * candidate that best fits the slide and writes a matching caption; it falls
 * back to heuristic scoring (`pickBest`) whenever the model is unavailable or
 * declines. Seeded candidates (the instructor's own uploads, SEED-2) join the
 * pool from the caller and carry the highest source prior.
 */
export const enrichImage = async (
  keywords: string[],
  seeded: ImageCandidate[] = [],
  context?: SlideImageContext,
): Promise<EnrichedImage | null> => {
  if (!keywords.length) return null

  const pool = [
    ...seeded,
    ...(await gatherCandidates(keywords, SOURCE_TIMEOUT_MS)),
  ]

  // Shortlist the top-scored, projector-sized candidates for the AI to judge.
  const shortlist = pool
    .filter(c => (c.width ?? MIN_WIDTH) >= MIN_WIDTH)
    .map(c => ({ c, score: scoreCandidate(c, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, env.IMAGE_RERANK_SHORTLIST)
    .map(x => x.c)

  if (context && shortlist.length) {
    const ranked = await rankAndCaption(context, shortlist)
    if (ranked) {
      const chosen = shortlist[ranked.index]!
      return {
        url: chosen.url,
        source: chosen.source,
        attribution: chosen.attribution,
        caption: ranked.caption,
      }
    }
  }

  // No context, or the re-rank was unavailable / declined: heuristic winner.
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
  context?: SlideImageContext,
): Promise<void> => {
  try {
    const image = await enrichImage(keywords, seeded, context)
    if (!image) return

    // 'fill': only set a caption the slide doesn't already have (manual
    // layout switch — never clobber a user's edit). Written BEFORE the image
    // so it is already present the moment imageRef lands and the client's
    // poll swaps in the whole slide.
    if (image.caption && context?.captionMode === 'fill') {
      await SlideModel.updateOne(
        { _id: slideId, caption: { $in: [null, ''] } },
        { caption: image.caption },
      )
    }

    // Fill only a slide that has no image yet. "No image" means the field
    // is absent (never set) OR an empty string — the latter is a common,
    // documented state (an image the user removed, or a placeholder left by
    // a layout switch). Matching only { $exists: false } silently dropped
    // the sourced image whenever imageRef was ''. A real URL is still never
    // overwritten (IMG-3 stability). 'replace' captions ride this same write
    // so the caption reaches the client together with the image.
    const replaceCaption =
      image.caption && context?.captionMode === 'replace'
        ? { caption: image.caption }
        : {}
    await SlideModel.updateOne(
      { _id: slideId, imageRef: { $in: [null, ''] } },
      {
        imageRef: image.url,
        imageSource: image.source === 'seeded' ? 'seeded' : 'stock',
        attribution: compactAttribution(image.attribution),
        ...replaceCaption,
      },
    )
  } catch (error) {
    // Enrichment must never surface as an error anywhere (IMG-2)
    console.warn('Image enrichment skipped:', error)
  }
}
