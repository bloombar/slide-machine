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
  DeckDeleteInput,
  DeckResetAccessInput,
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
  loadDeckAcl,
  resolveDeckAcl,
  loadDeckAcls,
  toDeckDto,
  toSharedDeckDto,
  touchDeck,
  type DeckDb,
} from '../models/deck'
import {
  canEditAcl,
  canViewAcl,
  isAclMember,
  type ResolvedAcl,
} from '../lib/access'
import { sharesOfAcl } from '../lib/shares'
import { UserModel } from '../models/user'
import { SlideModel, toSlideDto } from '../models/slide'
import { ProjectModel, projectAcl } from '../models/project'
import { getBuiltinTemplate, layoutDescriptors } from '../templates/builtin'
import { registry } from '../providers/registry'
import { permalinkSlug } from '../lib/slug'
import { enrichSlideImage } from '../enrichment/enrich'
import type { ImageCandidate } from '../enrichment/types'
import { SeedAssetModel, type SeedAssetDb } from '../models/seed-asset'
import { getStorage } from '../storage'

type SeedAssetDoc = HydratedDocument<SeedAssetDb>
import { env } from '../config/env'
import type {
  ImageGuidance,
  SeededImageDescriptor,
} from '@slide-machine/shared'

/**
 * Kicks off background image enrichment AFTER the SlideEvent is on its
 * way — never on the phrase→slide critical path, never throwing (IMG-2).
 * When the model picked a specific seeded image (GEN-7), it applies
 * directly; otherwise seeded images join the search pool with the top
 * source prior (SEED-2).
 */
const maybeEnrich = (
  slideId: string,
  guidance: ImageGuidance | undefined,
  seeded: SeedAssetDoc[] = [],
): void => {
  if (!env.IMAGE_ENRICHMENT_ENABLED) return
  if (!guidance || guidance.none) return

  const images = seeded.filter(a => a.type === 'image' && a.imageUrl)
  const chosen = guidance.seededImageId
    ? images.find(a => a._id.toString() === guidance.seededImageId)
    : undefined
  if (chosen?.imageUrl) {
    void SlideModel.updateOne(
      { _id: slideId, imageRef: { $exists: false } },
      { imageRef: chosen.imageUrl, imageSource: 'seeded' },
    ).catch(() => undefined)
    return
  }

  if (!guidance.keywords.length) return
  const candidates: ImageCandidate[] = images.map(a => ({
    url: a.imageUrl!,
    title: a.caption ?? a.name,
    tags: a.keywords,
    source: 'seeded',
  }))
  void enrichSlideImage(slideId, guidance.keywords, candidates)
}

/** Enabled, extracted seed assets that apply to a lecture: the
 * project's own plus the deck's (additive layering, SEED-1). */
const seedAssetsFor = async (
  deck: HydratedDocument<DeckDb>,
): Promise<{ project: SeedAssetDoc[]; deck: SeedAssetDoc[] }> => {
  const docs = await SeedAssetModel.find({
    projectId: deck.projectId,
    enabled: true,
    status: 'ready',
    $or: [{ deckId: { $exists: false } }, { deckId: deck._id }],
  })
  return {
    project: docs.filter(a => !a.deckId),
    deck: docs.filter(a => a.deckId),
  }
}

/** One seed-context layer: typed notes first, then extracted text. */
const seedLayer = (
  notes: string | undefined,
  assets: SeedAssetDoc[],
  maxChars = 8000,
): string | undefined => {
  const text = [notes, ...assets.map(a => a.text)]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars)
  return text || undefined
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

/** Loads a deck the acting user may edit — the owner or an editor,
 * whether granted on the lecture itself or inherited from its project. */
const loadEditableDeck = async (
  ctx: ActionContext,
  deckId: string,
): Promise<{ deck: HydratedDocument<DeckDb>; acl: ResolvedAcl }> => {
  const userId = requireUser(ctx)
  const deck = await DeckModel.findById(deckId).catch(() => null)
  if (!deck) throw new ActionForbiddenError()
  const acl = await loadDeckAcl(deck)
  if (!canEditAcl(acl, userId)) throw new ActionForbiddenError()
  return { deck, acl }
}

/**
 * Copy-on-write: the first explicit change to a lecture's privacy
 * settings snapshots the effective (inherited) ACL as the lecture's own
 * override; from then on the lecture stops following its project.
 */
const ensureOverride = (
  deck: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): void => {
  if (deck.accessOverride) return
  deck.accessOverride = {
    visibility: acl.visibility,
    viewers: [...acl.viewers],
    editors: [...acl.editors],
  }
}

export const deckCreate = defineAction<DeckCreateInput, Deck>({
  name: 'deck.create',
  input: z.object({
    projectId: z.string().min(1),
    // Untitled lectures are fine; the UI labels them "Untitled lecture"
    title: z.string().trim().default(''),
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
      permalinkSlug: permalinkSlug(input.title || 'untitled'),
    })
    return toDeckDto(deck, await loadDeckAcl(deck))
  },
})

export const deckList = defineAction<DeckListInput, Deck[]>({
  name: 'deck.list',
  input: z.object({ projectId: z.string().min(1).optional() }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    if (input.projectId) {
      // Project members see the project's (viewable) lectures
      const project = await ProjectModel.findById(input.projectId).catch(
        () => null,
      )
      if (!project || !isAclMember(projectAcl(project), userId))
        throw new ActionForbiddenError()
      const docs = await DeckModel.find({ projectId: input.projectId }).sort({
        updatedAt: -1,
      })
      const acls = await loadDeckAcls(docs)
      return docs
        .filter(d => canViewAcl(acls.get(d._id.toString())!, userId))
        .map(d => toDeckDto(d, acls.get(d._id.toString())!))
    }
    const docs = await DeckModel.find({ ownerId: userId }).sort({
      updatedAt: -1,
    })
    const acls = await loadDeckAcls(docs)
    return docs.map(d => toDeckDto(d, acls.get(d._id.toString())!))
  },
})

export const deckGet = defineAction<DeckGetInput, DeckViewResponse>({
  name: 'deck.get',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const deck = await DeckModel.findById(input.deckId).catch(() => null)
    if (!deck) throw new ActionForbiddenError()
    const acl = await loadDeckAcl(deck)
    if (!canViewAcl(acl, userId)) throw new ActionForbiddenError()
    const template = getBuiltinTemplate(deck.templateId)
    if (!template)
      throw new ActionValidationError('deck.get', ['template no longer exists'])
    const slides = await SlideModel.find({ deckId: deck._id }).sort({
      index: 1,
    })
    const isOwner = acl.ownerId === userId
    return {
      deck: isOwner ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl),
      slides: slides.map(toSlideDto),
      template,
      canEdit: canEditAcl(acl, userId),
    }
  },
})

export const slideAdd = defineAction<SlideAddInput, Slide>({
  name: 'slide.add',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
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
    // Clearing the title is allowed; it displays as "Untitled lecture"
    title: z.string().trim(),
  }),
  execute: async (ctx, input) => {
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
    deck.title = input.title
    await deck.save()
    return toDeckDto(deck, acl)
  },
})

export const deckSwitchTemplate = defineAction<DeckSwitchTemplateInput, Deck>({
  name: 'deck.switchTemplate',
  input: z.object({
    deckId: z.string().min(1),
    templateId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
    if (!getBuiltinTemplate(input.templateId)) {
      throw new ActionValidationError('deck.switchTemplate', [
        'templateId: unknown template',
      ])
    }
    deck.templateId = input.templateId
    await deck.save()
    return toDeckDto(deck, acl)
  },
})

export const deckReorderSlides = defineAction<DeckReorderInput, Deck>({
  name: 'deck.reorderSlides',
  input: z.object({
    deckId: z.string().min(1),
    slideOrder: z.array(z.string().min(1)).min(1),
  }),
  execute: async (ctx, input) => {
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
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
    return toDeckDto(deck, acl)
  },
})

export const sessionPhrase = defineAction<SessionPhraseInput, SlideEvent>({
  name: 'session.phrase',
  input: z.object({
    deckId: z.string().min(1),
    phrase: z.string().trim().min(1).max(2000),
  }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
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

    // Seed layers bias generation toward the planned material (PROJ-1/
    // SEED-1): typed notes plus extracted text, project- and deck-level
    const [project, assets] = await Promise.all([
      ProjectModel.findById(deck.projectId),
      seedAssetsFor(deck),
    ])
    const seededImages: SeededImageDescriptor[] = [
      ...assets.project,
      ...assets.deck,
    ]
      .filter(a => a.type === 'image' && a.imageUrl)
      .map(a => ({
        id: a._id.toString(),
        caption: a.caption ?? a.name,
        keywords: a.keywords,
      }))

    const provider = registry.get<GenerationProvider>('generation')
    const result = await provider.generateSlideContent({
      phrase: input.phrase,
      rollingContext,
      seedContext: {
        project: seedLayer(project?.seedContext, assets.project),
        deck: seedLayer(deck.seedContext, assets.deck),
      },
      layoutDescriptors: layoutDescriptors(template),
      seededImages: seededImages.length ? seededImages : undefined,
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
        maybeEnrich(lastSlide._id.toString(), result.imageGuidance, [
          ...assets.project,
          ...assets.deck,
        ])
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
    maybeEnrich(slide._id.toString(), result.imageGuidance, [
      ...assets.project,
      ...assets.deck,
    ])
    return { kind: 'slide.new', slide: toSlideDto(slide) }
  },
})

const sharesOf = sharesOfAcl

export const deckSetSeedNotes = defineAction<DeckSetSeedNotesInput, Deck>({
  name: 'deck.setSeedNotes',
  input: z.object({
    deckId: z.string().min(1),
    seedContext: z.string().max(20_000),
  }),
  execute: async (ctx, input) => {
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
    deck.seedContext = input.seedContext
    await deck.save()
    return toDeckDto(deck, acl)
  },
})

export const deckSetAccess = defineAction<DeckSetAccessInput, Deck>({
  name: 'deck.setAccess',
  input: z.object({
    deckId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: async (ctx, input) => {
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
    ensureOverride(deck, acl)
    deck.accessOverride!.visibility = input.visibility
    deck.markModified('accessOverride')
    await deck.save()
    return toDeckDto(deck, resolveDeckAcl(deck, null))
  },
})

/** Drops the lecture's override so it follows its project again. */
export const deckResetAccess = defineAction<DeckResetAccessInput, Deck>({
  name: 'deck.resetAccess',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    deck.accessOverride = undefined
    deck.markModified('accessOverride')
    await deck.save()
    return toDeckDto(deck, await loadDeckAcl(deck))
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
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
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
    ensureOverride(deck, acl)
    const override = deck.accessOverride!
    const list = input.role === 'editor' ? override.editors : override.viewers
    if (!list.includes(userId)) list.push(userId)
    // One role per user: granting one revokes the other
    const other = input.role === 'editor' ? override.viewers : override.editors
    const index = other.indexOf(userId)
    if (index >= 0) other.splice(index, 1)
    deck.markModified('accessOverride')
    await deck.save()
    return sharesOf(resolveDeckAcl(deck, null))
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
    const { deck, acl } = await loadEditableDeck(ctx, input.deckId)
    ensureOverride(deck, acl)
    const override = deck.accessOverride!
    const list = input.role === 'editor' ? override.editors : override.viewers
    const index = list.indexOf(input.userId)
    if (index >= 0) list.splice(index, 1)
    deck.markModified('accessOverride')
    await deck.save()
    return sharesOf(resolveDeckAcl(deck, null))
  },
})

export const deckShares = defineAction<DeckSharesInput, DeckShare[]>({
  name: 'deck.shares',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) =>
    sharesOf((await loadEditableDeck(ctx, input.deckId)).acl),
})

export const deckDelete = defineAction<DeckDeleteInput, { deleted: true }>({
  name: 'deck.delete',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const deck = await loadOwnedDeck(ctx, input.deckId)

    // Cascade: slides, lecture-level seed assets (and their stored
    // files), then the deck itself
    const assets = await SeedAssetModel.find({ deckId: deck._id })
    const storage = getStorage()
    await Promise.all(
      assets
        .filter(a => a.storageKey)
        .map(a =>
          storage.delete(a.storageKey!).catch(() => {
            // A dangling file is preferable to a failed delete
          }),
        ),
    )
    await Promise.all([
      SlideModel.deleteMany({ deckId: deck._id }),
      SeedAssetModel.deleteMany({ deckId: deck._id }),
    ])
    await deck.deleteOne()
    return { deleted: true }
  },
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
    // Transfers pin an override: the old owner's continued edit access
    // must not depend on the project's (their own) settings
    ensureOverride(deck, await loadDeckAcl(deck))
    const override = deck.accessOverride!
    // The new owner leaves the people list; the old owner stays an editor
    override.viewers = override.viewers.filter(id => id !== targetId)
    override.editors = override.editors.filter(id => id !== targetId)
    if (ctx.userId && !override.editors.includes(ctx.userId)) {
      override.editors.push(ctx.userId)
    }
    deck.ownerId = target._id
    deck.markModified('accessOverride')
    await deck.save()
    // The caller is no longer the owner, so share lists stay behind
    return toSharedDeckDto(deck, resolveDeckAcl(deck, null))
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
registerAction(deckResetAccess)
registerAction(deckShare)
registerAction(deckUnshare)
registerAction(deckShares)
registerAction(deckDelete)
registerAction(deckTransferOwnership)
