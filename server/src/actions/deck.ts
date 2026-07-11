/**
 * Deck and live-session actions (PROJ-2, CAP-1, GEN-1/GEN-8, SHARE-1 via
 * TECH-13). session.phrase is the heart of the pipeline: one finalized
 * phrase in, one SlideEvent out — the same contract a streamed transport
 * will use once real STT lands.
 */
import { z } from 'zod'
import type {
  Deck,
  DeckCreateInput,
  DeckGetInput,
  DeckListInput,
  DeckRenameInput,
  DeckReorderInput,
  DeckViewResponse,
  GenerationProvider,
  SessionPhraseInput,
  Slide,
  SlideAddInput,
  SlideEvent,
} from '@slide-machine/shared'
import type { HydratedDocument } from 'mongoose'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import { DeckModel, toDeckDto, touchDeck, type DeckDb } from '../models/deck'
import { SlideModel, toSlideDto } from '../models/slide'
import { ProjectModel } from '../models/project'
import { getBuiltinTemplate, layoutDescriptors } from '../templates/builtin'
import { registry } from '../providers/registry'
import { permalinkSlug } from '../lib/slug'
import { enrichSlideImage } from '../enrichment/enrich'
import { env } from '../config/env'
import type { ImageGuidance } from '@slide-machine/shared'

/**
 * Kicks off background image enrichment AFTER the SlideEvent is on its
 * way — never on the phrase→slide critical path, never throwing (IMG-2).
 */
const maybeEnrich = (
  slideId: string,
  guidance: ImageGuidance | undefined,
): void => {
  if (!env.IMAGE_ENRICHMENT_ENABLED) return
  if (!guidance || guidance.none || !guidance.keywords.length) return
  void enrichSlideImage(slideId, guidance.keywords)
}

const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/** Loads a deck the acting user owns, or throws (no existence leaks). */
const loadOwnedDeck = async (
  ctx: ActionContext,
  deckId: string,
): Promise<HydratedDocument<DeckDb>> => {
  const userId = requireUser(ctx)
  const deck = await DeckModel.findById(deckId).catch(() => null)
  if (!deck || deck.ownerId.toString() !== userId)
    throw new ActionForbiddenError()
  return deck
}

export const deckCreate = defineAction<DeckCreateInput, Deck>({
  name: 'deck.create',
  input: z.object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1),
    templateId: z.string().min(1),
  }),
  authorize: async (ctx, input) => {
    const userId = requireUser(ctx)
    const project = await ProjectModel.findById(input.projectId).catch(
      () => null,
    )
    if (!project || project.ownerId.toString() !== userId)
      throw new ActionForbiddenError()
  },
  execute: async (ctx, input) => {
    if (!getBuiltinTemplate(input.templateId)) {
      throw new ActionValidationError('deck.create', [
        `templateId: unknown template`,
      ])
    }
    const deck = await DeckModel.create({
      projectId: input.projectId,
      ownerId: ctx.userId,
      title: input.title,
      templateId: input.templateId,
      permalinkSlug: permalinkSlug(input.title),
    })
    return toDeckDto(deck)
  },
})

export const deckList = defineAction<DeckListInput, Deck[]>({
  name: 'deck.list',
  input: z.object({ projectId: z.string().min(1).optional() }),
  execute: async (ctx, input) => {
    const filter: { ownerId: string; projectId?: string } = {
      ownerId: requireUser(ctx),
    }
    if (input.projectId) filter.projectId = input.projectId
    const docs = await DeckModel.find(filter).sort({ updatedAt: -1 })
    return docs.map(toDeckDto)
  },
})

export const deckGet = defineAction<DeckGetInput, DeckViewResponse>({
  name: 'deck.get',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    const template = getBuiltinTemplate(deck.templateId)
    if (!template)
      throw new ActionValidationError('deck.get', ['template no longer exists'])
    const slides = await SlideModel.find({ deckId: deck._id }).sort({
      index: 1,
    })
    return { deck: toDeckDto(deck), slides: slides.map(toSlideDto), template }
  },
})

export const slideAdd = defineAction<SlideAddInput, Slide>({
  name: 'slide.add',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    const slide = await SlideModel.create({
      deckId: deck._id,
      index: deck.slideOrder.length,
      layoutType: 'content',
      title: 'New slide',
      body: 'Click to edit',
    })
    deck.slideOrder.push(slide._id.toString())
    await deck.save()
    return toSlideDto(slide)
  },
})

export const deckRename = defineAction<DeckRenameInput, Deck>({
  name: 'deck.rename',
  input: z.object({
    deckId: z.string().min(1),
    title: z.string().trim().min(1),
  }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    deck.title = input.title
    await deck.save()
    return toDeckDto(deck)
  },
})

export const deckReorderSlides = defineAction<DeckReorderInput, Deck>({
  name: 'deck.reorderSlides',
  input: z.object({
    deckId: z.string().min(1),
    slideOrder: z.array(z.string().min(1)).min(1),
  }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    const current = [...deck.slideOrder].sort()
    const proposed = [...input.slideOrder].sort()
    if (
      current.length !== proposed.length ||
      current.some((id, i) => id !== proposed[i])
    ) {
      throw new ActionValidationError('deck.reorderSlides', [
        'slideOrder must contain exactly the current slide ids',
      ])
    }
    deck.slideOrder = input.slideOrder
    await deck.save()
    // Keep index consistent with slideOrder position
    await Promise.all(
      deck.slideOrder.map((id, i) =>
        SlideModel.updateOne({ _id: id }, { index: i }),
      ),
    )
    return toDeckDto(deck)
  },
})

export const sessionPhrase = defineAction<SessionPhraseInput, SlideEvent>({
  name: 'session.phrase',
  input: z.object({
    deckId: z.string().min(1),
    phrase: z.string().trim().min(1).max(2000),
  }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    const template = getBuiltinTemplate(deck.templateId)
    if (!template)
      throw new ActionValidationError('session.phrase', [
        'template no longer exists',
      ])

    // Rolling context: text of the last few slides keeps topics coherent
    const recent = await SlideModel.find({ deckId: deck._id })
      .sort({ index: -1 })
      .limit(3)
    const rollingContext = recent
      .reverse()
      .map(s =>
        [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join(' — '),
      )

    // Project seed notes bias generation toward the planned material (PROJ-1)
    const project = await ProjectModel.findById(deck.projectId)

    const provider = registry.get<GenerationProvider>('generation')
    const result = await provider.generateSlideContent({
      phrase: input.phrase,
      rollingContext,
      seedContext: project?.seedContext,
      layoutDescriptors: layoutDescriptors(template),
    })

    if (result.action === 'none') return { kind: 'none' }

    const lastSlide = recent.length ? recent[recent.length - 1] : undefined
    if (result.action === 'update' && lastSlide) {
      // Additive update (GEN-8): new bullets slot in, body extends,
      // layout may re-fit; committed text is never rewritten
      if (result.slots.bullets?.length) {
        lastSlide.bullets = [
          ...(lastSlide.bullets ?? []),
          ...result.slots.bullets,
        ]
      }
      if (result.slots.body) {
        lastSlide.body = [lastSlide.body, result.slots.body]
          .filter(Boolean)
          .join(' ')
      }
      lastSlide.layoutType = result.layoutType
      lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
        .filter(Boolean)
        .join(' ')
      await lastSlide.save()
      await touchDeck(deck._id)
      if (!lastSlide.imageRef)
        maybeEnrich(lastSlide._id.toString(), result.imageGuidance)
      return { kind: 'slide.update', slide: toSlideDto(lastSlide) }
    }

    const slide = await SlideModel.create({
      deckId: deck._id,
      index: deck.slideOrder.length,
      layoutType: result.layoutType,
      title: result.slots.title,
      body: result.slots.body,
      bullets: result.slots.bullets,
      caption: result.slots.caption,
      imageKeywords: result.imageGuidance?.keywords,
      sourceTranscript: input.phrase,
    })
    deck.slideOrder.push(slide._id.toString())
    deck.transcript = [deck.transcript, input.phrase].filter(Boolean).join('\n')
    await deck.save()
    maybeEnrich(slide._id.toString(), result.imageGuidance)
    return { kind: 'slide.new', slide: toSlideDto(slide) }
  },
})

registerAction(deckCreate)
registerAction(deckList)
registerAction(deckGet)
registerAction(deckRename)
registerAction(slideAdd)
registerAction(deckReorderSlides)
registerAction(sessionPhrase)
