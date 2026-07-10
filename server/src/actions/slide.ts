/**
 * Slide actions (TECH-13). slide.get lets the client pick up
 * asynchronously-enriched images (IMG-1) without any push transport.
 */
import { z } from 'zod'
import type { Slide } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { SlideModel, toSlideDto } from '../models/slide'
import { DeckModel } from '../models/deck'

export const slideGet = defineAction<{ slideId: string }, Slide>({
  name: 'slide.get',
  input: z.object({ slideId: z.string().min(1) }),
  execute: async (ctx, input) => {
    if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
    const slide = await SlideModel.findById(input.slideId).catch(() => null)
    if (!slide) throw new ActionForbiddenError()
    const deck = await DeckModel.findById(slide.deckId)
    if (!deck || deck.ownerId.toString() !== ctx.userId)
      throw new ActionForbiddenError()
    return toSlideDto(slide)
  },
})

registerAction(slideGet)
