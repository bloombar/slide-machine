/**
 * Sourcing the empty picture boxes on a slide (IMG-1/IMG-6).
 *
 * A slide sitting on an image-capable layout with an empty image slot has a
 * hole in it that nothing else will fill. This runs the enrichment pass that
 * fills it: keywords are derived from the slide's own words when nothing
 * supplied any, persisted so the intent survives a reload and the client can
 * poll for the arriving picture, and the search runs in the background,
 * strictly off the response path (IMG-2).
 *
 * Asked per box, not of the slide as a whole. A layout an author built may
 * have several picture boxes (IMG-6/TMPL-9), and a slide that already carries
 * one picture still has the others empty — gating on "does this slide have an
 * image" would leave them empty for good.
 */
import type { HydratedDocument } from 'mongoose'
import type { DeckDb } from '../models/deck'
import type { SlideDb } from '../models/slide'
import { layoutDescriptors } from '../templates/builtin'
import type { DeckTemplate } from '../templates/versions'
import { imageSlotNames, slotHasImage } from '../lib/image-layout'
import { enrichSlideImages } from '../enrichment/enrich'
import type { SlideImageContext } from '../enrichment/types'
import { deriveImageKeywords } from '../enrichment/keywords'
import { seedAssetsFor, seededImageCandidates } from '../lib/seed-assets'
import { env } from '../config/env'

/** The picture boxes of a slide's layout that hold nothing yet. */
export const emptyImageSlotsOf = (
  slide: HydratedDocument<SlideDb>,
  template: DeckTemplate,
): string[] =>
  imageSlotNames(slide.layoutType, layoutDescriptors(template)).filter(
    name => !slotHasImage(slide, name),
  )

/**
 * Gives a slide search terms for its empty picture boxes, mining its own
 * words when it has none. Returns the terms, or an empty array when there is
 * nothing to search for. Does not save.
 */
export const applyImageKeywords = (
  slide: HydratedDocument<SlideDb>,
): string[] => {
  if (slide.imageKeywords?.length) return slide.imageKeywords
  const derived = deriveImageKeywords(slide)
  if (derived.length) slide.imageKeywords = derived
  return derived
}

/**
 * Sources every empty picture box on a slide, in the background.
 *
 * Call *after* the slide is saved: the keywords have to be persisted for the
 * client to poll against, and a slide whose content arrived as a slot map only
 * has its title and body folded out of that map when it saves — mining them
 * beforehand would find an empty slide and search for nothing.
 *
 * `captionMode` is 'fill' where the slide may already carry a caption the
 * author wrote, so only an empty one is set.
 */
export const sourceEmptyImageSlots = (
  slide: HydratedDocument<SlideDb>,
  deck: HydratedDocument<DeckDb>,
  template: DeckTemplate,
  { captionMode = 'fill' as const } = {},
): void => {
  if (!env.IMAGE_ENRICHMENT_ENABLED) return
  const slots = emptyImageSlotsOf(slide, template)
  if (!slots.length) return
  const keywords = slide.imageKeywords
  if (!keywords?.length) return

  const slideId = slide._id.toString()
  const context: SlideImageContext = {
    title: slide.title,
    body: slide.body,
    bullets: slide.bullets,
    caption: slide.caption,
    imageKeywords: keywords,
    layoutType: slide.layoutType,
    captionMaxChars: template.layouts
      .find(l => l.type === slide.layoutType)
      ?.slots.find(s => s.name === 'caption')?.maxChars,
    seedContext: deck.seedContext?.slice(0, 1500) || undefined,
    captionMode,
  }

  // The lecture's own uploads are preferred over anything searched for: they
  // carry the highest source prior in the ranker (IMG-1).
  void seedAssetsFor(deck)
    .then(assets =>
      enrichSlideImages(
        slideId,
        slots,
        keywords,
        [
          ...seededImageCandidates(assets.project),
          ...seededImageCandidates(assets.deck),
        ],
        context,
      ),
    )
    .catch(() => undefined)
}
