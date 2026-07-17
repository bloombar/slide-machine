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
    imageRef: z.string().optional(),
    attribution: z
      .object({
        caption: z.string().optional(),
        title: z.string().optional(),
        creator: z.string().optional(),
        creatorUrl: z.string().optional(),
        sourceUrl: z.string().optional(),
        sourceName: z.string().optional(),
        license: z.string().optional(),
        licenseUrl: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (ctx, input) => {
    const { slide } = await loadOwnedSlide(ctx, input.slideId)
    if (input.title !== undefined) slide.title = input.title
    if (input.body !== undefined) slide.body = input.body
    if (input.bullets !== undefined) slide.bullets = input.bullets
    if (input.caption !== undefined) slide.caption = input.caption
    // '' removes the image; a URL sets it (EDIT-1)
    if (input.imageRef !== undefined) slide.imageRef = input.imageRef
    // Image credit/licensing from the "i" dialog (IMG-5); all-empty clears it
    if (input.attribution !== undefined) {
      const a = input.attribution
      const any = Object.values(a).some(v => v != null && v !== '')
      slide.attribution = any ? a : undefined
    }
    await slide.save()
    await touchDeck(slide.deckId)
    return toSlideDto(slide)
  },
})

/** Per-slide layout switch (EDIT-3): the target must be one of the
 * deck template's layouts; slot content is preserved as-is. */
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
    await slide.save()
    await touchDeck(slide.deckId)
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
