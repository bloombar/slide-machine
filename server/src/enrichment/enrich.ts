/**
 * Enrichment orchestrator (IMG-1/IMG-2). All sources are queried in
 * parallel with a hard per-source timeout; failures collapse to empty
 * result sets. Runs strictly OFF the phrase→slide critical path: the
 * SlideEvent has already been returned when this starts, and the result
 * (if any) is persisted for the client to pick up.
 */
import { SlideModel } from '../models/slide'
import { slotsOf } from '../lib/slide-slots'
import { env } from '../config/env'
import { currentUsageUser } from '../billing/usage-context'
import { userHasCapacity } from '../billing/meter-hooks'
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
  /** Pictures already on the slide. Several image slots sourced from one
   * brief would otherwise all pick the same winner (IMG-6). */
  exclude: ReadonlySet<string> = new Set(),
): Promise<EnrichedImage | null> => {
  if (!keywords.length) return null

  const pool = [
    ...seeded,
    ...(await gatherCandidates(keywords, SOURCE_TIMEOUT_MS)),
  ].filter(c => !exclude.has(c.url))

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

/** The picture URLs a slide already holds, in any of its slots. */
const usedImageUrls = async (slideId: string): Promise<Set<string>> => {
  const slide = await SlideModel.findById(slideId, {
    imageRef: 1,
    slots: 1,
  }).catch(() => null)
  if (!slide) return new Set()
  const urls = Object.values(slotsOf(slide))
    .filter(v => v.kind === 'image')
    .map(v => (v.kind === 'image' ? v.ref : undefined))
  return new Set([slide.imageRef, ...urls].filter((u): u is string => !!u))
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
 *
 * An exhausted `imageLookups` allowance simply skips the search (BILL-4). This
 * path has no response to carry a 402: the slide was returned long ago and the
 * user is watching for a picture to appear. A slide that stays text-only is the
 * same outcome enrichment already produces whenever no source has a good
 * match, so it degrades along a path the UI already handles.
 */
/**
 * Sources every image slot a layout declares (IMG-6). A layout with two
 * pictures gets two, one at a time so each sees what the previous one took
 * and no slot ends up with the same picture as its neighbour. One slot
 * failing never stops the next — `enrichSlideImage` swallows its own errors.
 */
export const enrichSlideImages = async (
  slideId: string,
  slots: string[],
  keywords: string[],
  seeded: ImageCandidate[] = [],
  context?: SlideImageContext,
): Promise<void> => {
  for (const slot of slots.length ? slots : ['image']) {
    await enrichSlideImage(slideId, keywords, seeded, context, slot)
  }
}

export const enrichSlideImage = async (
  slideId: string,
  keywords: string[],
  seeded: ImageCandidate[] = [],
  context?: SlideImageContext,
  slot = 'image',
): Promise<void> => {
  try {
    const payer = currentUsageUser()
    if (payer && !(await userHasCapacity(payer, 'imageLookups'))) return

    // A layout may declare several image slots (IMG-6), and each is sourced
    // on its own. Pictures already on the slide are excluded so two slots
    // filled from one brief do not come back as the same picture twice.
    const taken = await usedImageUrls(slideId)
    const image = await enrichImage(keywords, seeded, context, taken)
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

    // Fill only a picture box that holds nothing yet. The box itself is the
    // whole question: the slot map is where a slide's content lives, so a
    // slot with a real URL is a picture the user has and is never overwritten
    // (IMG-3 stability), and a slot without one is a hole to fill. "Holds
    // nothing" means the slot is absent (never written) OR its ref is an
    // empty string — the latter is a common, documented state (an image the
    // user removed, or a placeholder left by a layout switch), and matching
    // only { $exists: false } silently dropped the sourced image. The
    // mirrored top-level `imageRef` gets no say: it is a derived copy of
    // `slots.image`, so letting it veto this write would leave a slide whose
    // copy and map disagree unable to converge — the picture box permanently
    // unfillable. 'replace' captions ride this same write so the caption
    // reaches the client together with the image.
    const replaceCaption =
      image.caption && context?.captionMode === 'replace'
        ? { caption: image.caption }
        : {}
    const path = `slots.${slot}`
    await SlideModel.updateOne(
      {
        _id: slideId,
        $or: [
          { [`${path}.ref`]: { $in: [null, ''] } },
          { [path]: { $exists: false } },
        ],
      },
      {
        [path]: {
          kind: 'image',
          ref: image.url,
          source: image.source === 'seeded' ? 'seeded' : 'stock',
          attribution: compactAttribution(image.attribution),
        },
        // The conventional slot keeps its derived fields in step, since the
        // atomic update bypasses the model's save hook.
        ...(slot === 'image'
          ? {
              imageRef: image.url,
              imageSource: image.source === 'seeded' ? 'seeded' : 'stock',
              attribution: compactAttribution(image.attribution),
            }
          : {}),
        ...replaceCaption,
      },
    )
  } catch (error) {
    // Enrichment must never surface as an error anywhere (IMG-2)
    console.warn('Image enrichment skipped:', error)
  }
}
