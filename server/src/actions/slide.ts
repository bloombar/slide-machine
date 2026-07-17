/**
 * Slide actions (TECH-13). slide.get lets the client pick up
 * asynchronously-enriched images (IMG-1); slide.editContent and
 * slide.delete are the first EDIT-1 operations. Ownership is enforced
 * through the slide's deck; missing and foreign both read as forbidden.
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  LayoutType,
  Slide,
  SlideDeleteInput,
  SlideEditInput,
  SlideSetLayoutInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import { SlideModel, toSlideDto, type SlideDb } from '../models/slide'
import { DeckModel, loadDeckAcl, touchDeck, type DeckDb } from '../models/deck'
import { getBuiltinTemplate } from '../templates/builtin'
import { canEditAcl } from '../lib/access'
import { layoutHasImageSlot } from '../lib/image-layout'
import { enrichSlideImage } from '../enrichment/enrich'
import { deriveImageKeywords } from '../enrichment/keywords'
import { seedAssetsFor, seededImageCandidates } from '../lib/seed-assets'
import { env } from '../config/env'

interface OwnedSlide {
  slide: HydratedDocument<SlideDb>
  deck: HydratedDocument<DeckDb>
}

/** Loads a slide the acting user may edit (via its deck's ACL), or throws. */
const loadOwnedSlide = async (
  ctx: ActionContext,
  slideId: string,
): Promise<OwnedSlide> => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  const slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) throw new ActionForbiddenError()
  const deck = await DeckModel.findById(slide.deckId)
  if (!deck) throw new ActionForbiddenError()
  if (!canEditAcl(await loadDeckAcl(deck), ctx.userId))
    throw new ActionForbiddenError()
  return { slide, deck }
}

export const slideGet = defineAction<{ slideId: string }, Slide>({
  name: 'slide.get',
  input: z.object({ slideId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { slide } = await loadOwnedSlide(ctx, input.slideId)
    return toSlideDto(slide)
  },
})

export const slideEditContent = defineAction<SlideEditInput, Slide>({
  name: 'slide.editContent',
  input: z.object({
    slideId: z.string().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    caption: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const { slide } = await loadOwnedSlide(ctx, input.slideId)
    if (input.title !== undefined) slide.title = input.title
    if (input.body !== undefined) slide.body = input.body
    if (input.bullets !== undefined) slide.bullets = input.bullets
    if (input.caption !== undefined) slide.caption = input.caption
    await slide.save()
    await touchDeck(slide.deckId)
    return toSlideDto(slide)
  },
})

/** Per-slide layout switch (EDIT-3): the target must be one of the
 * deck template's layouts; slot content is preserved as-is. Moving onto an
 * image-capable layout with no image yet kicks off background enrichment
 * (IMG-1) so the empty image slot fills itself. */
export const slideSetLayout = defineAction<SlideSetLayoutInput, Slide>({
  name: 'slide.setLayout',
  input: z.object({
    slideId: z.string().min(1),
    layoutType: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const { slide, deck } = await loadOwnedSlide(ctx, input.slideId)
    const template = getBuiltinTemplate(deck.templateId)
    if (!template?.layouts.some(l => l.type === input.layoutType)) {
      throw new ActionValidationError('slide.setLayout', [
        'layoutType: not a layout of this template',
      ])
    }
    slide.layoutType = input.layoutType as LayoutType

    // Switching onto a layout with an image slot on a slide that has no
    // image yet: source one via enrichment. Derive keywords from the
    // slide's own text when the model left none, and persist them so the
    // intent survives a reload and the client polls for the arriving image.
    const shouldSource =
      env.IMAGE_ENRICHMENT_ENABLED &&
      !slide.imageRef &&
      layoutHasImageSlot(input.layoutType, template.layouts)
    if (shouldSource && !slide.imageKeywords?.length) {
      const derived = deriveImageKeywords(slide)
      if (derived.length) slide.imageKeywords = derived
    }

    await slide.save()
    await touchDeck(slide.deckId)

    if (shouldSource && slide.imageKeywords?.length) {
      // Fire-and-forget, strictly off the response path (IMG-2): load the
      // lecture's seeded uploads to prefer, then enrich in the background.
      const keywords = slide.imageKeywords
      const slideId = slide._id.toString()
      void seedAssetsFor(deck)
        .then(assets =>
          enrichSlideImage(slideId, keywords, [
            ...seededImageCandidates(assets.project),
            ...seededImageCandidates(assets.deck),
          ]),
        )
        .catch(() => undefined)
    }

    return toSlideDto(slide)
  },
})

export const slideDelete = defineAction<
  SlideDeleteInput,
  { deleted: true; slideOrder: string[] }
>({
  name: 'slide.delete',
  input: z.object({ slideId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { slide, deck } = await loadOwnedSlide(ctx, input.slideId)
    await slide.deleteOne()
    deck.slideOrder = deck.slideOrder.filter(id => id !== input.slideId)
    await deck.save()
    // Keep index consistent with slideOrder position
    await Promise.all(
      deck.slideOrder.map((id, i) =>
        SlideModel.updateOne({ _id: id }, { index: i }),
      ),
    )
    return { deleted: true, slideOrder: deck.slideOrder }
  },
})

registerAction(slideGet)
registerAction(slideEditContent)
registerAction(slideSetLayout)
registerAction(slideDelete)
