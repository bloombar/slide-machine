/**
 * Slide actions (TECH-13). slide.get lets the client pick up
 * asynchronously-enriched images (IMG-1); slide.editContent and
 * slide.delete are the first EDIT-1 operations. Ownership is enforced
 * through the slide's deck; missing and foreign both read as forbidden.
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  Slide,
  SlideDeleteInput,
  SlideEditInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { SlideModel, toSlideDto, type SlideDb } from '../models/slide'
import { DeckModel, touchDeck, type DeckDb } from '../models/deck'

interface OwnedSlide {
  slide: HydratedDocument<SlideDb>
  deck: HydratedDocument<DeckDb>
}

/** Loads a slide the acting user owns (via its deck), or throws. */
const loadOwnedSlide = async (
  ctx: ActionContext,
  slideId: string,
): Promise<OwnedSlide> => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  const slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) throw new ActionForbiddenError()
  const deck = await DeckModel.findById(slide.deckId)
  if (!deck || deck.ownerId.toString() !== ctx.userId)
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
registerAction(slideDelete)
