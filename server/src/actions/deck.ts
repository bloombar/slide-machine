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
  DeckSetAccessInput,
  DeckSetSeedNotesInput,
  DeckShare,
  DeckShareInput,
  DeckSharesInput,
  DeckTransferOwnershipInput,
  DeckUnshareInput,
  DeckGetInput,
  DeckListInput,
  DeckRenameInput,
  DeckReorderInput,
  DeckSwitchTemplateInput,
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
import {
  DeckModel,
  canEditDeck,
  canViewDeck,
  toDeckDto,
  toSharedDeckDto,
  touchDeck,
  type DeckDb,
} from '../models/deck'
import { UserModel } from '../models/user'
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

/** Loads a deck the acting user may edit (owner or shared editor). */
const loadEditableDeck = async (
  ctx: ActionContext,
  deckId: string,
): Promise<HydratedDocument<DeckDb>> => {
  const userId = requireUser(ctx)
  const deck = await DeckModel.findById(deckId).catch(() => null)
  if (!deck || !canEditDeck(deck, userId)) throw new ActionForbiddenError()
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
    const userId = requireUser(ctx)
    const deck = await DeckModel.findById(input.deckId).catch(() => null)
    if (!deck || !canViewDeck(deck, userId)) throw new ActionForbiddenError()
    const template = getBuiltinTemplate(deck.templateId)
    if (!template)
      throw new ActionValidationError('deck.get', ['template no longer exists'])
    const slides = await SlideModel.find({ deckId: deck._id }).sort({
      index: 1,
    })
    const isOwner = deck.ownerId.toString() === userId
    return {
      deck: isOwner ? toDeckDto(deck) : toSharedDeckDto(deck),
      slides: slides.map(toSlideDto),
      template,
      canEdit: canEditDeck(deck, userId),
    }
  },
})

export const slideAdd = defineAction<SlideAddInput, Slide>({
  name: 'slide.add',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
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
    const deck = await loadEditableDeck(ctx, input.deckId)
    deck.title = input.title
    await deck.save()
    return toDeckDto(deck)
  },
})

export const deckSwitchTemplate = defineAction<DeckSwitchTemplateInput, Deck>({
  name: 'deck.switchTemplate',
  input: z.object({
    deckId: z.string().min(1),
    templateId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
    if (!getBuiltinTemplate(input.templateId)) {
      throw new ActionValidationError('deck.switchTemplate', [
        'templateId: unknown template',
      ])
    }
    deck.templateId = input.templateId
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
    const deck = await loadEditableDeck(ctx, input.deckId)
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
    const deck = await loadEditableDeck(ctx, input.deckId)
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
      seedContext: {
        project: project?.seedContext,
        deck: deck.seedContext,
      },
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

/** The owner-facing share list: granted users with names and roles. */
const sharesOf = async (
  deck: HydratedDocument<DeckDb>,
): Promise<DeckShare[]> => {
  const ids = [...new Set([...deck.viewers, ...deck.editors])]
  const users = await UserModel.find({ _id: { $in: ids } })
  const byId = new Map(users.map(u => [u._id.toString(), u]))
  const entry = (userId: string, role: DeckShare['role']): DeckShare | null => {
    const user = byId.get(userId)
    if (!user) return null
    return {
      userId,
      displayName: user.displayName,
      email: user.email,
      role,
    }
  }
  return [
    ...deck.viewers.map(id => entry(id, 'viewer')),
    ...deck.editors.map(id => entry(id, 'editor')),
  ].filter((share): share is DeckShare => share !== null)
}

export const deckSetSeedNotes = defineAction<DeckSetSeedNotesInput, Deck>({
  name: 'deck.setSeedNotes',
  input: z.object({
    deckId: z.string().min(1),
    seedContext: z.string().max(20_000),
  }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
    deck.seedContext = input.seedContext
    await deck.save()
    return toDeckDto(deck)
  },
})

export const deckSetAccess = defineAction<DeckSetAccessInput, Deck>({
  name: 'deck.setAccess',
  input: z.object({
    deckId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
    deck.visibility = input.visibility
    await deck.save()
    return toDeckDto(deck)
  },
})

export const deckShare = defineAction<DeckShareInput, DeckShare[]>({
  name: 'deck.share',
  input: z.object({
    deckId: z.string().min(1),
    email: z.email(),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
    const user = await UserModel.findOne({
      email: input.email.toLowerCase().trim(),
    })
    if (!user) {
      throw new ActionValidationError('deck.share', [
        'email: no account with that email',
      ])
    }
    const userId = user._id.toString()
    if (userId === deck.ownerId.toString()) {
      throw new ActionValidationError('deck.share', [
        'email: that user owns this lecture',
      ])
    }
    const list = input.role === 'editor' ? deck.editors : deck.viewers
    if (!list.includes(userId)) list.push(userId)
    // One role per user: granting one revokes the other
    const other = input.role === 'editor' ? deck.viewers : deck.editors
    const index = other.indexOf(userId)
    if (index >= 0) other.splice(index, 1)
    await deck.save()
    return sharesOf(deck)
  },
})

export const deckUnshare = defineAction<DeckUnshareInput, DeckShare[]>({
  name: 'deck.unshare',
  input: z.object({
    deckId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: async (ctx, input) => {
    const deck = await loadEditableDeck(ctx, input.deckId)
    const list = input.role === 'editor' ? deck.editors : deck.viewers
    const index = list.indexOf(input.userId)
    if (index >= 0) {
      list.splice(index, 1)
      await deck.save()
    }
    return sharesOf(deck)
  },
})

export const deckShares = defineAction<DeckSharesInput, DeckShare[]>({
  name: 'deck.shares',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) =>
    sharesOf(await loadEditableDeck(ctx, input.deckId)),
})

export const deckTransferOwnership = defineAction<
  DeckTransferOwnershipInput,
  Deck
>({
  name: 'deck.transferOwnership',
  input: z.object({
    deckId: z.string().min(1),
    userId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)
    const target = await UserModel.findById(input.userId).catch(() => null)
    if (!target) {
      throw new ActionValidationError('deck.transferOwnership', [
        'userId: no such user',
      ])
    }
    const targetId = target._id.toString()
    if (targetId === ctx.userId) {
      throw new ActionValidationError('deck.transferOwnership', [
        'userId: already the owner',
      ])
    }
    // The new owner leaves the people list; the old owner stays an editor
    deck.viewers = deck.viewers.filter(id => id !== targetId)
    deck.editors = deck.editors.filter(id => id !== targetId)
    if (ctx.userId && !deck.editors.includes(ctx.userId)) {
      deck.editors.push(ctx.userId)
    }
    deck.ownerId = target._id
    await deck.save()
    // The caller is no longer the owner, so share lists stay behind
    return toSharedDeckDto(deck)
  },
})

registerAction(deckCreate)
registerAction(deckList)
registerAction(deckGet)
registerAction(deckRename)
registerAction(deckSwitchTemplate)
registerAction(slideAdd)
registerAction(deckReorderSlides)
registerAction(sessionPhrase)
registerAction(deckSetSeedNotes)
registerAction(deckSetAccess)
registerAction(deckShare)
registerAction(deckUnshare)
registerAction(deckShares)
registerAction(deckTransferOwnership)
