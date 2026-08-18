/**
 * Deck and live-session actions (PROJ-2, CAP-1, GEN-1/GEN-8, SHARE-1 via
 * TECH-13). session.phrase is the heart of the pipeline: one finalized
 * phrase in, one SlideEvent out — the same contract whether the phrase
 * arrives from the typed Speak bar or a streamed STT transport.
 */
import { z } from 'zod'
import { requireVerifiedEmail } from '../auth/verified'
import type {
  Deck,
  DeckCreateInput,
  DeckDeleteInput,
  DeckResetAccessInput,
  DeckSetAccessInput,
  DeckSetGenerationFreedomInput,
  DeckSetLanguageInput,
  DeckSetRefineSettingsInput,
  DeckSetTtsVoiceInput,
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
  DeckTemplateUpdateStatusInput,
  DeckApplyTemplateUpdateInput,
  DeckViewResponse,
  TemplateUpdateStatus,
  GenerationProvider,
  SessionPhraseInput,
  Slide,
  SlideAddInput,
  SlideEvent,
  TranscriptSegmentAction,
} from '@slide-machine/shared'
import {
  LOCALES,
  WHITEBOARD_LAYOUT_TYPE,
  hasVisibleDrawings,
} from '@slide-machine/shared'
import type { HydratedDocument, Types } from 'mongoose'
import { defineAction } from './define'
import {
  custom,
  deckEditor,
  deckOwner,
  deckSettings,
  deckSettingsView,
  deckViewer,
  projectOwner,
  type DeckAccess,
  type DeckSettingsAccess,
  type ProjectAccess,
  type Signed,
} from './access'
import { requireAiTokens } from '../billing/meter-hooks'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import {
  DeckModel,
  ensureDeckOverride,
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
import { ttsVoiceIdSchema } from '../lib/tts-voice'
import { sharesOfAcl } from '../lib/shares'
import {
  clampToBudget,
  refitOverflows,
  titleFromPhrase,
  updateOverflows,
  charCount,
} from '../lib/slide-fit'
import { declaredContentOf, onlyDeclaredBy } from '../lib/generated-slots'
import {
  layoutDisplaysContent,
  isHeaderLayout,
  refitPreservesContent,
  safeLayoutType,
  type SlideContentSnapshot,
} from '../lib/layout-refit'
import {
  imageSlotNames,
  layoutHasImageSlot,
  reconcileImageLayout,
} from '../lib/image-layout'
import { UserModel } from '../models/user'
import { VoteModel, voteBreakdown } from '../models/vote'
import type { MyVote } from '@slide-machine/shared'
import { SlideModel, toSlideDto } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { ProjectModel, projectAcl } from '../models/project'
import { asOf, isAllowlistedAdmin, withDeleted } from '../lib/admin-view'
import { withDeckSettingsAudit } from '../lib/admin-edit'
import { recordSettingsChange } from '../audit/settings-log'
import { deckSettingsSnapshot } from '../lib/settings-snapshot'
import { defaultTemplateId, layoutDescriptors } from '../templates/builtin'
import { templateExists } from '../templates/resolve'
import {
  resolveDeckTemplate,
  resolveDeckTemplateForRead,
  pinDeckToCurrent,
  currentVersionIdFor,
  ensureVersion,
  getVersion,
} from '../templates/versions'
import {
  planTemplateSwitch,
  planUpdate,
  templateUpdateStatus,
  pendingTemplateFor,
} from '../templates/template-update'
import { slotsOf, remapSlots } from '../lib/slide-slots'
import { remapSlideTranslations } from '../lib/translate-slides'
import { buildDeckStructure, headerLayoutTypes } from '../lib/deck-structure'
import { registry } from '../providers/registry'
import { GenerationUnavailableError } from '../providers/errors'
import { recordSessionEvent } from '../telemetry/recorder'
import { withGenerationSignals } from '../telemetry/generation-signals'
import type { TelemetryOutcome } from '../models/session-telemetry-event'
import { permalinkSlug } from '../lib/slug'
import { enrichSlideImages } from '../enrichment/enrich'
import type { SlideImageContext } from '../enrichment/types'
import {
  seedAssetsFor,
  seededAttribution,
  seededImageCandidates,
  type SeedAssetDoc,
} from '../lib/seed-assets'
import { deleteDeckCascade } from '../lib/cascade'
import { env } from '../config/env'
import type {
  ImageGuidance,
  SeededImageDescriptor,
} from '@slide-machine/shared'
import { VOICE_COMMAND_DESCRIPTORS } from '@slide-machine/shared'

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
  context?: SlideImageContext,
  /** The layout's image slots (IMG-6); a layout with two pictures gets two. */
  slots: string[] = ['image'],
): void => {
  if (!env.IMAGE_ENRICHMENT_ENABLED) return
  if (!guidance || guidance.none) return

  const images = seeded.filter(a => a.type === 'image' && a.imageUrl)
  const chosen = guidance.seededImageId
    ? images.find(a => a._id.toString() === guidance.seededImageId)
    : undefined
  if (chosen?.imageUrl) {
    // The chosen picture goes in the layout's first image slot; any others
    // are left for enrichment or the instructor to fill.
    const slot = slots[0] ?? 'image'
    void SlideModel.updateOne(
      // "No image yet" is an absent field OR an empty string (see
      // enrichSlideImage); a real URL is never overwritten (IMG-3).
      {
        _id: slideId,
        $and: [
          {
            $or: [
              { [`slots.${slot}.ref`]: { $in: [null, ''] } },
              { [`slots.${slot}`]: { $exists: false } },
            ],
          },
          // A slide written before the map keeps its picture in the old
          // field alone, and that picture is still the user's (IMG-3).
          ...(slot === 'image' ? [{ imageRef: { $in: [null, ''] } }] : []),
        ],
      },
      {
        [`slots.${slot}`]: {
          kind: 'image',
          ref: chosen.imageUrl,
          source: 'seeded',
          attribution: seededAttribution(chosen),
        },
        ...(slot === 'image'
          ? {
              imageRef: chosen.imageUrl,
              imageSource: 'seeded',
              attribution: seededAttribution(chosen),
            }
          : {}),
      },
    ).catch(() => undefined)
    return
  }

  if (!guidance.keywords.length) return
  void enrichSlideImages(
    slideId,
    slots,
    guidance.keywords,
    seededImageCandidates(images),
    context,
  )
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

/** The content gate, shared by every action here that edits a lecture. */
const byDeckId = deckEditor((input: { deckId: string }) => input.deckId)

/** The settings gate: an owner or editor, otherwise an allowlisted admin
 * overriding the ACL, whose edit is then audited (ADMIN-5). */
const settingsOf = deckSettings((input: { deckId: string }) => input.deckId)

/** The same admission, for an action that only reads the settings. */
const settingsReadOf = deckSettingsView(
  (input: { deckId: string }) => input.deckId,
)

/** Owner-only, deliberately stricter than the content gate: deleting a
 * lecture or handing it on is not something an editor may do. */
const ownerOf = deckOwner((input: { deckId: string }) => input.deckId)

/** Anyone who may read the lecture — public counts. */
const viewerOf = deckViewer((input: { deckId: string }) => input.deckId)

/**
 * Loads a deck the acting user may edit — the owner or an editor,
 * whether granted on the lecture itself or inherited from its project.
 *
 * This is the CONTENT gate: slides, recordings, refine runs, quizzes and
 * exports all pass through it, and an admin viewing another user's
 * lecture never does (ADMIN-3 keeps that read-only). The actions that
 * change a lecture's SETTINGS use editDeckSettings (lib/admin-edit.ts)
 * instead, which also admits an allowlisted admin and audits the change
 * (ADMIN-5) — those are the ones the settings modal drives.
 */
export const loadEditableDeck = async (
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

export const deckCreate = defineAction<DeckCreateInput, Deck, ProjectAccess>({
  name: 'deck.create',
  input: z.object({
    projectId: z.string().min(1),
    // Untitled lectures are fine; the UI labels them "Untitled lecture"
    title: z.string().trim().default(''),
  }),
  // The lecture does not exist yet, so what is authorized is the project it
  // is being created in — owner only, as it has always been.
  access: projectOwner((input: { projectId: string }) => input.projectId),
  execute: async (ctx, input, { project }) => {
    // The project's template is the creation-time default; the lecture
    // stores its own copy and can switch independently afterwards
    const templateId = (await templateExists(project?.templateId ?? ''))
      ? project!.templateId
      : defaultTemplateId()
    const deck = await DeckModel.create({
      projectId: input.projectId,
      ownerId: ctx.userId,
      title: input.title,
      // A lecture named at creation is user-set; the AI must not retitle it.
      titleLocked: Boolean(input.title?.trim()),
      templateId,
      // Pin the template as it stands now (TMPL-11), so later edits to it are
      // offered to this lecture rather than applied to it.
      templateVersionId: await currentVersionIdFor(templateId),
      permalinkSlug: permalinkSlug(input.title || 'untitled'),
    })
    return toDeckDto(deck, await loadDeckAcl(deck))
  },
})

export const deckList = defineAction<DeckListInput, Deck[], Signed>({
  name: 'deck.list',
  // Two admission models in one action, and no single resource to resolve:
  // with a project id it admits a member, an allowlisted admin (including
  // for a TOMBSTONED project, whose lectures went down with it — ADMIN-6),
  // or anyone when the project is public; without one it lists only the
  // caller's own, where the query is the check. A per-row ACL filter then
  // decides what comes back, which no single level describes.
  access: custom(
    'admission differs by whether a project is named, and an admin may list a deleted project’s lectures (ADMIN-6); a per-row filter then decides what is returned',
  ),
  input: z.object({ projectId: z.string().min(1).optional() }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    if (input.projectId) {
      // Project members see the project's (viewable) lectures
      let project = await ProjectModel.findById(input.projectId).catch(
        () => null,
      )
      // Allowlisted admins get an always-on read bypass (lib/admin-view.ts).
      // They can already open any lecture in the viewer, so listing the
      // project's lectures here — private ones included — leaks nothing new.
      // The bypass covers a tombstoned project too, whose lectures went down
      // with it (ADMIN-6); project.get is where that opening is audited.
      let admin = false
      if (!project) {
        if (!(await isAllowlistedAdmin(userId)))
          throw new ActionForbiddenError()
        admin = true
        project = await ProjectModel.findById(input.projectId)
          .setOptions(withDeleted)
          .catch(() => null)
      }
      if (!project) throw new ActionForbiddenError()
      const member = isAclMember(projectAcl(project), userId)
      if (!admin) admin = !member && (await isAllowlistedAdmin(userId))
      // A PUBLIC project is browsable by anyone (SOC discovery); the per-deck
      // ACL filter below still limits a non-member to its public lectures.
      const publicProject = !member && !admin && project.visibility === 'public'
      if (!member && !admin && !publicProject) {
        throw new ActionForbiddenError()
      }
      // A tombstoned project lists the lectures deleted with it, as its admin
      // page does — the ones a restore would bring back.
      const { filter, options } = asOf(project.deletedAt)
      const docs = await DeckModel.find({
        projectId: input.projectId,
        ...filter,
      })
        .sort({ updatedAt: -1 })
        .setOptions(options)
      const acls = await loadDeckAcls(docs, {
        withDeleted: Boolean(project.deletedAt),
      })
      return docs
        .filter(d => admin || canViewAcl(acls.get(d._id.toString())!, userId))
        .map(d => toDeckDto(d, acls.get(d._id.toString())!))
    }
    const docs = await DeckModel.find({ ownerId: userId }).sort({
      updatedAt: -1,
    })
    const acls = await loadDeckAcls(docs)
    return docs.map(d => toDeckDto(d, acls.get(d._id.toString())!))
  },
})

export const deckGet = defineAction<DeckGetInput, DeckViewResponse, DeckAccess>(
  {
    name: 'deck.get',
    // Anyone who may read the lecture. Which SHAPE they get back — the owner's
    // full view or the shared one — is not an access decision and stays below,
    // reading the ACL this already resolved rather than loading it again.
    access: viewerOf,
    input: z.object({ deckId: z.string().min(1) }),
    execute: async (ctx, input, { userId, deck, acl }) => {
      const template = await resolveDeckTemplateForRead(deck)
      if (!template)
        throw new ActionValidationError('deck.get', [
          'template no longer exists',
        ])
      const slides = await SlideModel.find({ deckId: deck._id }).sort({
        index: 1,
      })
      const isOwner = acl.ownerId === userId
      const project = await ProjectModel.findById(deck.projectId).catch(
        () => null,
      )
      const owner = await UserModel.findById(deck.ownerId)
        .select('displayName')
        .catch(() => null)
      const myVote: MyVote =
        (
          await VoteModel.findOne({
            userId,
            targetType: 'deck',
            targetId: deck._id,
          })
        )?.value ?? 0
      const { up: voteUp, down: voteDown } = await voteBreakdown(
        'deck',
        deck._id,
      )
      return {
        deck: isOwner ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl),
        slides: slides.map(toSlideDto),
        template,
        canEdit: canEditAcl(acl, userId),
        projectGenerationFreedom:
          project?.generationFreedom ?? env.GENERATION_FREEDOM,
        owner: { id: acl.ownerId, displayName: owner?.displayName ?? '' },
        project: { id: deck.projectId.toString(), title: project?.title ?? '' },
        myVote,
        voteUp,
        voteDown,
      }
    },
  },
)

export const slideAdd = defineAction<SlideAddInput, Slide, DeckAccess>({
  name: 'slide.add',
  access: byDeckId,
  input: z.object({
    deckId: z.string().min(1),
    layoutType: z.string().min(1).optional(),
  }),
  execute: async (ctx, input, { deck }) => {
    let layoutType = 'content'
    if (input.layoutType) {
      const template = await resolveDeckTemplate(deck)
      if (!template?.layouts.some(l => l.type === input.layoutType)) {
        throw new ActionValidationError('slide.add', [
          'layoutType: not a layout of this template',
        ])
      }
      layoutType = input.layoutType
    }
    // A new slide starts empty, the way one does in every slide tool.
    //
    // It used to be seeded with the words "New slide" and "Click to edit", so
    // that its boxes had something clickable in them. They are real content:
    // stored, rendered to an audience, exported, and read aloud by TTS unless
    // the author noticed and deleted them. That was a workaround for an empty
    // box being invisible, and an empty box now draws itself and says what to
    // put in it — so the workaround costs more than it buys.
    const slide = await SlideModel.create({
      deckId: deck._id,
      index: deck.slideOrder.length,
      layoutType,
    })
    deck.slideOrder.push(slide._id.toString())
    await deck.save()
    return toSlideDto(slide)
  },
})

export const deckRename = defineAction<
  DeckRenameInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.rename',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    // Clearing the title is allowed; it displays as "Untitled lecture"
    title: z.string().trim(),
  }),
  // A settings edit (the title field lives in the settings modal), so
  // admins may rename another user's lecture — audited, see below.
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      deck.title = input.title
      // A hand-entered title locks out AI titling; clearing it back to empty
      // hands control back to the auto-title refinement.
      deck.titleLocked = Boolean(input.title.trim())
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

/**
 * Whether the lecture's template has been edited since it was pinned, and
 * what taking that edit would cost (TMPL-11).
 *
 * Read-only, and safe to call whenever the settings pane opens: it compares
 * two fingerprints and only walks slides when they differ.
 */
export const deckTemplateUpdateStatus = defineAction<
  DeckTemplateUpdateStatusInput,
  TemplateUpdateStatus,
  DeckAccess
>({
  name: 'deck.templateUpdateStatus',
  access: byDeckId,
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck }) => {
    const slides = await SlideModel.find({ deckId: deck._id }).select(
      '_id layoutType slots title body bullets caption imageRef',
    )
    return templateUpdateStatus(
      deck,
      slides.map(slide => ({
        id: slide._id.toString(),
        layoutType: slide.layoutType,
        slots: slotsOf(slide),
      })),
    )
  },
})

/**
 * Rebuilds the lecture on its template's current structure (TMPL-11).
 *
 * The move is `pairSlots`, the same pairing that carries content across a
 * per-slide layout switch and drives the transition animation — so a box
 * keeps its content wherever the updated layout still has somewhere to put
 * it, by name first and by what it holds second.
 *
 * Content that pairs with nothing is deliberately **left on the slide** by
 * `remapSlots` rather than deleted. The updated layout simply does not draw
 * it, so the cost of a bad update is content that needs re-placing, not
 * content that is gone — which is what the confirmation dialog promises.
 *
 * A layout the update removes outright is left alone: its slides keep both
 * their content and their layout name rather than being forced onto some
 * other layout this code would have to invent. They are reported ahead of
 * time so the choice is the user's.
 */
export const deckApplyTemplateUpdate = defineAction<
  DeckApplyTemplateUpdateInput,
  Deck,
  DeckAccess
>({
  name: 'deck.applyTemplateUpdate',
  access: byDeckId,
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck, acl }) => {
    const pinned = await getVersion(deck.templateVersionId ?? undefined)
    if (!pinned) {
      throw new ActionValidationError('deck.applyTemplateUpdate', [
        'this lecture does not pin a template version',
      ])
    }
    const live = await pendingTemplateFor(deck, pinned)
    if (!live) {
      throw new ActionValidationError('deck.applyTemplateUpdate', [
        'this template has no update to apply',
      ])
    }

    const slides = await SlideModel.find({ deckId: deck._id })
    const plans = planUpdate(
      pinned,
      live,
      new Set(slides.map(s => s.layoutType)),
    )

    for (const slide of slides) {
      const plan = plans.get(slide.layoutType)
      if (!plan || plan.layoutRemoved) continue
      const moved = Object.entries(plan.pairs).some(([from, to]) => from !== to)
      if (!moved) continue
      const before = slotsOf(slide)
      slide.slots = remapSlots(before, plan.pairs)
      slide.markModified('slots')
      await slide.save()
      // The words did not change, only the box they sit in — carry the
      // cached translations across with them rather than paying to
      // translate the same text again (SHARE-2).
      await remapSlideTranslations(deck._id, slide._id.toString(), plan.pairs, {
        id: slide._id.toString(),
        slots: before,
      })
    }

    const next = await ensureVersion(live)
    deck.templateVersionId = next.id
    await deck.save()
    return toDeckDto(deck, acl)
  },
})

/**
 * Moves the lecture onto a different design (TMPL-8/TMPL-11).
 *
 * Applying an imported design to a lecture that already has slides is the case
 * that made this more than a field assignment. An imported template names its
 * layouts after whatever its slides turned out to be, so the deck's slides
 * were left sitting on layout types the new design has never heard of, holding
 * content under box names it does not declare — a lecture that went blank.
 *
 * So each slide is carried across by `planTemplateSwitch`, which chooses its
 * new layout and re-maps its boxes with `pairSlots` — the same pairing behind
 * a per-slide layout switch, a template update and the transition animation.
 * One pairing, so none of them can disagree about which box became which.
 *
 * Content that pairs with nothing is LEFT on the slide rather than deleted:
 * the new layout simply does not draw it, so switching back finds it intact,
 * and `slide.refitLayout` (GEN-9) has it as source material for the boxes the
 * move left empty. Filling those is deliberately not done here — it is an AI
 * call per slide, and a settings change should not quietly spend a lecture's
 * worth of tokens.
 */
export const deckSwitchTemplate = defineAction<
  DeckSwitchTemplateInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.switchTemplate',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    templateId: z.string().min(1),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      if (!(await templateExists(input.templateId))) {
        throw new ActionValidationError('deck.switchTemplate', [
          'templateId: unknown template',
        ])
      }
      // The design being left, read before anything is reassigned — the
      // pairing needs both sides as they actually are.
      const previous = await resolveDeckTemplate(deck)

      deck.templateId = input.templateId
      // Switching templates pins the new one as it stands (TMPL-11) — the
      // lecture is being rebuilt on it deliberately, which is exactly when
      // taking its current structure is what the user asked for.
      await pinDeckToCurrent(deck)
      await deck.save()

      const next = await resolveDeckTemplate(deck)
      if (previous && next) {
        const slides = await SlideModel.find({ deckId: deck._id })
        const plans = planTemplateSwitch(
          previous,
          next,
          slides.map(slide => ({
            id: slide._id.toString(),
            layoutType: slide.layoutType,
            slots: slotsOf(slide),
          })),
        )
        for (const slide of slides) {
          const plan = plans.get(slide._id.toString())
          if (!plan) continue
          const moved = Object.entries(plan.pairs).some(
            ([fromName, toName]) => fromName !== toName,
          )
          const before = slotsOf(slide)
          if (moved) {
            slide.slots = remapSlots(before, plan.pairs)
            slide.markModified('slots')
          }
          slide.layoutType = plan.layoutType
          await slide.save()
          // The words did not change, only the box they sit in — carry the
          // cached translations across rather than paying to translate the
          // same text again (SHARE-2).
          if (moved) {
            await remapSlideTranslations(
              deck._id,
              slide._id.toString(),
              plan.pairs,
              { id: slide._id.toString(), slots: before },
            )
          }
        }
      }
      return toDeckDto(deck, acl)
    }),
})

export const deckReorderSlides = defineAction<
  DeckReorderInput,
  Deck,
  DeckAccess
>({
  name: 'deck.reorderSlides',
  access: byDeckId,
  input: z.object({
    deckId: z.string().min(1),
    slideOrder: z.array(z.string().min(1)).min(1),
  }),
  execute: async (ctx, input, { deck, acl }) => {
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

/** How much of the current slide's spoken transcript to send the model (the
 * most recent characters), so it can see what the slide already covers without
 * bloating the prompt on a long-dwelt slide. */
const LIVE_TRANSCRIPT_CHARS = 4000

export const sessionPhrase = defineAction<
  SessionPhraseInput,
  SlideEvent,
  DeckAccess
>({
  name: 'session.phrase',
  access: byDeckId,
  meter: requireAiTokens,
  input: z.object({
    deckId: z.string().min(1),
    phrase: z.string().trim().min(1).max(2000),
    browserLanguage: z.string().trim().max(35).optional(),
    // Diarization groundwork (GEN-4): optional per-recording id and word
    // timings/confidence stored on the phrase's TranscriptSegment. All
    // optional so typed input and the browser engine still validate.
    sessionId: z.string().trim().min(1).max(200).optional(),
    confidence: z.number().min(0).max(1).optional(),
    words: z
      .array(
        z.object({
          word: z.string(),
          startMs: z.number(),
          endMs: z.number(),
          confidence: z.number().optional(),
        }),
      )
      .max(2000)
      .optional(),
    // Whiteboard drawing is active on the client (WB-3): don't auto-create a
    // slide from this phrase; append it to the current slide instead.
    suppressNewSlide: z.boolean().optional(),
    // Content generation is paused on the client (WB-3): record this phrase to
    // the transcript but skip slide generation entirely (no LLM call). Set
    // while the user is actively marking up a slide, or until they resume.
    pauseGeneration: z.boolean().optional(),
  }),
  execute: async (ctx, input, { deck }) => {
    const template = await resolveDeckTemplate(deck)
    if (!template)
      throw new ActionValidationError('session.phrase', [
        'template no longer exists',
      ])

    // Rolling context: text of the last few slides keeps topics coherent
    const recent = await SlideModel.find({ deckId: deck._id })
      .sort({ index: -1 })
      .limit(3)

    // Content generation is paused while the user marks up a slide, or until
    // they resume it (WB-3): record this phrase to the transcript and the
    // current slide's source transcript, then return without generating — no
    // content or layout change. Drawings save on their own path
    // (slide.editDrawings), so both speech and markup are kept for playback.
    //
    // Fast path taken only when AI voice commands are OFF: nothing to detect,
    // so skip the LLM entirely. With the flag ON we fall through and run
    // generation so the model can still flag operational phrases (CAP-4) even
    // while paused — the pause guard below then records the transcript and
    // skips all content, so voice commands keep working during drawing.
    if (input.pauseGeneration && !env.GENERATION_VOICE_COMMANDS) {
      const current = recent.length ? recent[0] : undefined
      deck.transcript = [deck.transcript, input.phrase]
        .filter(Boolean)
        .join('\n')
      await deck.save()
      const segmentWords = input.words?.length ? input.words : undefined
      await TranscriptSegmentModel.create({
        deckId: deck._id,
        sessionId: input.sessionId,
        text: input.phrase,
        confidence: input.confidence,
        words: segmentWords,
        startMs: segmentWords ? segmentWords[0]!.startMs : undefined,
        endMs: segmentWords
          ? segmentWords[segmentWords.length - 1]!.endMs
          : undefined,
        action: 'none',
        slideId: current?._id,
      })
      if (current) {
        current.sourceTranscript = [current.sourceTranscript, input.phrase]
          .filter(Boolean)
          .join(' ')
        await current.save()
      }
      // Telemetry (EVAL-1): a phrase row with no generationMs — no model ran.
      if (input.sessionId)
        recordSessionEvent({
          sessionId: input.sessionId,
          deckId: deck._id.toString(),
          kind: 'phrase',
          outcome: 'none',
        })
      return { kind: 'none' }
    }

    const rollingContext = recent
      .reverse()
      .map(s =>
        [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join(' — '),
      )

    // Seed layers bias generation toward the planned material (PROJ-1/
    // SEED-1): typed notes plus extracted text, project- and deck-level
    const [project, assets, speaker] = await Promise.all([
      ProjectModel.findById(deck.projectId),
      seedAssetsFor(deck),
      UserModel.findById(ctx.userId),
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

    const lastSlide = recent.length ? recent[recent.length - 1] : undefined
    const descriptors = layoutDescriptors(template)

    // A slide the user has marked up with the whiteboard must not shift under
    // their strokes: updates to it are additive only — the layout is held fixed
    // and no refit (which reformats/re-maps content) may run (WB-1). New
    // content can still append; an overflowing update still spills to a new
    // slide. Combined with active-drawing suppression into `keepLayout`.
    const targetHasDrawings = hasVisibleDrawings(lastSlide?.drawings)
    const keepLayout = Boolean(input.suppressNewSlide) || targetHasDrawings

    // A heading slide (title/section) — most visibly the title card a lecture
    // opens with — introduces rather than accumulates, so its layout is PINNED
    // during live generation: the model may sharpen its title/caption in place,
    // but must never convert it into a content layout while the speaker talks
    // on. Added material spills to a new slide instead (the header rule below).
    // Only automatic changes are blocked — the user can still switch a slide's
    // layout by hand (slide.setLayout, EDIT-3).
    const pinLayout = Boolean(
      lastSlide && isHeaderLayout(lastSlide.layoutType, descriptors),
    )

    // Deck-structure context (GENERATION_DECK_STRUCTURE): a compact outline of
    // the heading (title/section) slides so far plus positional signals, so the
    // windowed model can judge title/section decisions from the deck's shape.
    // Built only when the flag is on and the deck already has slides.
    let deckStructure: ReturnType<typeof buildDeckStructure> | undefined
    if (env.GENERATION_DECK_STRUCTURE && deck.slideOrder.length) {
      const headingDocs = await SlideModel.find(
        {
          deckId: deck._id,
          layoutType: { $in: headerLayoutTypes(descriptors) },
        },
        { title: 1, layoutType: 1 },
      )
      deckStructure = buildDeckStructure(
        headingDocs.map(s => ({
          id: String(s._id),
          layoutType: s.layoutType,
          title: s.title,
        })),
        deck.slideOrder.map(String),
      )
    }

    // What the current slide holds, as the model needs to see it.
    //
    // The conventional four are for re-fitting, so they ride the same flag the
    // re-fit does. The boxes a template's author named are different: an
    // update REPLACES one outright, so the model must see the current listing
    // to edit it rather than overwrite it — true whether or not layouts may
    // change (GEN-11).
    const declaredNow = lastSlide
      ? declaredContentOf(slotsOf(lastSlide), lastSlide.layoutType, descriptors)
      : {}
    const currentSlideContent =
      env.GENERATION_LAYOUT_REFIT || Object.keys(declaredNow).length
        ? {
            ...(env.GENERATION_LAYOUT_REFIT
              ? {
                  title: lastSlide?.title,
                  body: lastSlide?.body,
                  bullets: lastSlide?.bullets,
                  caption: lastSlide?.caption,
                }
              : {}),
            ...(Object.keys(declaredNow).length
              ? { declared: declaredNow }
              : {}),
          }
        : undefined

    const provider = registry.get<GenerationProvider>('generation')
    // Telemetry (EVAL-1): time the model call — including its internal
    // re-asks, which is generation as the speaker experiences it — and count
    // refusals through the ambient signal scope. A failure writes an error
    // row, then rethrows unchanged; the record must observe the live path,
    // never alter it.
    const genStart = Date.now()
    let generated: Awaited<ReturnType<typeof provider.generateSlideContent>>
    let genRefusals = 0
    try {
      ;({ result: generated, refusals: genRefusals } =
        await withGenerationSignals(() =>
          provider.generateSlideContent({
            phrase: input.phrase,
            rollingContext,
            seedContext: {
              project: seedLayer(project?.seedContext, assets.project),
              deck: seedLayer(deck.seedContext, assets.deck),
            },
            layoutDescriptors: descriptors,
            // What the design asks for, for every lecture drawn with it (GEN-11).
            // Read from the template rather than the deck's pinned snapshot: this
            // is guidance for writing, not structure the deck is drawn from, so an
            // author who adjusts it means it to apply next time they speak.
            templateInstructions: template.aiInstructions,
            deckStructure,
            seededImages: seededImages.length ? seededImages : undefined,
            freedom:
              deck.generationFreedom ??
              project?.generationFreedom ??
              env.GENERATION_FREEDOM,
            // Language precedence: lecture ?? project ?? speaker profile ??
            // the speaker's browser (sent with the phrase); nothing stored
            // anywhere leaves the model mirroring the speech
            language:
              deck.language ??
              project?.language ??
              speaker?.language ??
              input.browserLanguage,
            currentSlide: lastSlide
              ? {
                  layoutType: lastSlide.layoutType,
                  bulletCount: lastSlide.bullets?.length ?? 0,
                  bodyChars: charCount(lastSlide.body),
                  // The exact slot content, so a refit re-maps real text
                  // instead of guessing from the rolling context
                  content: currentSlideContent,
                  // Everything spoken while on this slide, so the model can see what
                  // it already covers (kept to a recent window to bound the prompt).
                  sourceTranscript:
                    lastSlide.sourceTranscript?.slice(-LIVE_TRANSCRIPT_CHARS) ||
                    undefined,
                }
              : undefined,
            // Feature flag (GENERATION_LAYOUT_REFIT): updates may switch the
            // slide's layout, including a full refit (GEN-8). Never while the user is
            // hand-annotating the current slide, nor on a slide that already carries
            // whiteboard marks (WB-1/WB-3) — its layout must hold still.
            allowLayoutRefit: env.GENERATION_LAYOUT_REFIT && !keepLayout,
            // Feature flag (GENERATION_LIVE_REPHRASE): a refit may also keep the
            // layout and re-state existing content for clearer phrasing. Needs refit
            // enabled (its vehicle) and not while locking the layout for drawing.
            allowRephrase:
              env.GENERATION_LAYOUT_REFIT &&
              env.GENERATION_LIVE_REPHRASE &&
              !keepLayout,
            // The slide is being drawn on or already has marks: tell the model to
            // keep its layout (the server also enforces this below).
            lockLayout: keepLayout,
            // The current slide is a heading slide: tell the model its layout is
            // fixed and new content belongs on a new slide (also enforced below).
            pinLayout,
            // Feature flag (GENERATION_VOICE_COMMANDS): offer the CAP-4
            // command set so the model can flag operational phrases
            voiceCommands: env.GENERATION_VOICE_COMMANDS
              ? VOICE_COMMAND_DESCRIPTORS
              : undefined,
            // Ask the model to suggest/refine the title on every phrase until
            // the user locks it by naming the lecture themselves (titleLocked).
            suggestDeckTitle: !deck.titleLocked,
          }),
        ))
    } catch (error) {
      if (input.sessionId)
        recordSessionEvent({
          sessionId: input.sessionId,
          deckId: deck._id.toString(),
          kind: 'generation_error',
          errorKind:
            error instanceof GenerationUnavailableError
              ? 'unavailable'
              : 'error',
          ...(error instanceof GenerationUnavailableError
            ? { retryable: error.retryable }
            : {}),
          errorMessage: String((error as Error)?.message ?? error).slice(
            0,
            200,
          ),
        })
      throw error
    }
    const generationMs = Date.now() - genStart
    /** One telemetry row per live phrase, stamped with how it landed. */
    const phraseEvent = (outcome: TelemetryOutcome): void => {
      if (!input.sessionId) return
      recordSessionEvent({
        sessionId: input.sessionId,
        deckId: deck._id.toString(),
        kind: 'phrase',
        outcome,
        generationMs,
        ...(genRefusals ? { refusals: genRefusals } : {}),
      })
    }

    // Never trust the model's layoutType (belt-and-suspenders to the prompt):
    // coerce anything outside the pickable set — e.g. it echoed the current
    // slide's own non-selectable "whiteboard" layout — to a safe one, so an
    // invalid layout can never be persisted.
    const safeLayout = safeLayoutType(
      generated.layoutType,
      descriptors,
      lastSlide?.layoutType,
    )
    const rawResult =
      generated.layoutType === safeLayout
        ? generated
        : { ...generated, layoutType: safeLayout }

    // Apply the model's latest title suggestion as long as the user has not
    // locked the title, so an auto-title keeps refining as the topic
    // clarifies. The event carries the new title so the header updates live.
    let savedDeckTitle: string | undefined
    const suggestion = rawResult.deckTitle?.trim().slice(0, 80)
    // No content changes while paused — that includes auto-titling the lecture.
    if (
      !input.pauseGeneration &&
      !deck.titleLocked &&
      suggestion &&
      suggestion !== deck.title
    ) {
      deck.title = suggestion
      savedDeckTitle = suggestion
      await deck.save()
    }
    const event = (e: SlideEvent): SlideEvent =>
      savedDeckTitle ? { ...e, deckTitle: savedDeckTitle } : e

    // Slide context for the image AI re-rank (IMG-1): lets the model pick the
    // candidate that best fits this slide/lecture and caption it to match.
    const imageContext = (
      fields: {
        title?: string
        body?: string
        bullets?: string[]
        caption?: string
        imageKeywords?: string[]
        layoutType: string
      },
      captionMode: 'replace' | 'fill',
    ): SlideImageContext => ({
      ...fields,
      captionMaxChars: template?.layouts
        .find(l => l.type === fields.layoutType)
        ?.slots.find(s => s.name === 'caption')?.maxChars,
      seedContext:
        [project?.seedContext, deck.seedContext]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 1500) || undefined,
      captionMode,
    })

    // AI-recognized voice command: nothing persists (no slide, no
    // transcript); the client executes it like a wake-worded command.
    // With the flag off nothing was offered, so a "command" claim is a
    // provider bug — degrade to filler rather than act on it
    if (rawResult.action === 'command') {
      const real = env.GENERATION_VOICE_COMMANDS && rawResult.command
      phraseEvent(real ? 'command' : 'none')
      return real
        ? { kind: 'command', command: rawResult.command! }
        : event({ kind: 'none' })
    }

    // Every finalized phrase is part of the lecture record — even filler that
    // changes no slide, and even a phrase whose slide update is later
    // discarded — so the transcript stays complete for post-lecture
    // reformatting (GEN-4). Persist it now, before any slide work, so no
    // return path can drop it. Only voice commands (handled above) are
    // excluded, being operation rather than lecture content.
    deck.transcript = [deck.transcript, input.phrase].filter(Boolean).join('\n')
    await deck.save()

    // Structured, timestamped counterpart to the flat append above (GEN-4
    // diarization groundwork): one append-only segment per finalized phrase, in
    // its own collection. Inserted now with action 'none' so no return path can
    // drop it — exactly like the flat string — then refined with the slide
    // linkage once the outcome is known. Voice commands are excluded
    // automatically, having returned before the append above. `startMs`/`endMs`
    // derive from the word timings (absent for browser/typed input).
    const segmentWords = input.words?.length ? input.words : undefined
    const segment = await TranscriptSegmentModel.create({
      deckId: deck._id,
      sessionId: input.sessionId,
      text: input.phrase,
      confidence: input.confidence,
      words: segmentWords,
      startMs: segmentWords ? segmentWords[0]!.startMs : undefined,
      endMs: segmentWords
        ? segmentWords[segmentWords.length - 1]!.endMs
        : undefined,
      action: 'none',
    })
    /** Refines the segment with how the phrase related to a slide, once known.
     * Doubles as the telemetry outcome stamp (EVAL-1): the classification the
     * transcript stores is exactly what the phrase row should carry. */
    const linkSegment = (
      action: TranscriptSegmentAction,
      slideId?: Types.ObjectId,
    ): Promise<unknown> => {
      phraseEvent(action)
      return TranscriptSegmentModel.updateOne(
        { _id: segment._id },
        slideId ? { action, slideId } : { action },
      )
    }

    // Content generation is paused (drawing) but AI voice commands are on, so
    // generation ran only to let the model flag a command (handled above). A
    // non-command phrase records to the current slide's transcript and stops —
    // no content or layout change, exactly like filler.
    if (input.pauseGeneration) {
      if (lastSlide) {
        lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
          .filter(Boolean)
          .join(' ')
        await lastSlide.save()
        await linkSegment('none', lastSlide._id)
      } else phraseEvent('none')
      return event({ kind: 'none' })
    }

    if (rawResult.action === 'none') {
      // Filler still belongs to whatever slide is on screen, so it joins that
      // slide's own source transcript too (it just changes no content).
      if (lastSlide) {
        lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
          .filter(Boolean)
          .join(' ')
        await lastSlide.save()
        await linkSegment('none', lastSlide._id)
      } else phraseEvent('none')
      return event({ kind: 'none' })
    }

    // Full layout refit (GEN-8 / GENERATION_LAYOUT_REFIT): the model
    // returned the COMPLETE slide re-mapped to a new layout. Verified
    // before it touches the deck — a refit we can't verify is safer
    // discarded (one phrase lost) than half-applied (audience content
    // lost). Old slot data the new layout hides is kept on the
    // document, so a later layout switch (EDIT-3) strands nothing.
    if (
      rawResult.action === 'update' &&
      rawResult.updateMode === 'refit' &&
      lastSlide &&
      // Never refit (a layout change) while the user is drawing, nor on a slide
      // that already has marks (WB-1/WB-3): fall through to a plain additive
      // delta update that keeps the current layout.
      !keepLayout &&
      // A whiteboard slide is a blank drawing canvas — never convert it into a
      // text layout; speech becomes a new slide instead (handled below).
      lastSlide.layoutType !== WHITEBOARD_LAYOUT_TYPE &&
      // Header slides (title/section) are refit-eligible only WITHIN their own
      // layout: a same-layout refit re-maps their slots in place (e.g. a
      // sharper title/caption), but one that would switch the layout is
      // refused here so the title card stays a title card mid-lecture
      // (`pinLayout`). It falls through to the header rule below, which turns
      // the added material into a new slide.
      !(pinLayout && rawResult.layoutType !== lastSlide.layoutType)
    ) {
      if (!env.GENERATION_LAYOUT_REFIT) {
        phraseEvent('discarded')
        return event({ kind: 'none' })
      }
      // A refit that keeps the same layout is a pure rephrase of existing
      // content. When live rephrasing is off, keep the committed slide text
      // verbatim mid-lecture — drop this refit rather than rewrite the slide.
      if (
        rawResult.layoutType === lastSlide.layoutType &&
        !env.GENERATION_LIVE_REPHRASE
      ) {
        phraseEvent('discarded')
        return event({ kind: 'none' })
      }
      const snapshot: SlideContentSnapshot = {
        title: lastSlide.title,
        body: lastSlide.body,
        bullets: lastSlide.bullets,
        caption: lastSlide.caption,
        hasImage: Boolean(lastSlide.imageRef),
      }
      if (
        !refitPreservesContent(rawResult, snapshot, descriptors) ||
        refitOverflows(rawResult, descriptors)
      ) {
        phraseEvent('discarded')
        return event({ kind: 'none' })
      }
      const refit = clampToBudget(rawResult, descriptors)
      if (refit.slots.title) lastSlide.title = refit.slots.title
      if (refit.slots.body) lastSlide.body = refit.slots.body
      if (refit.slots.bullets?.length) lastSlide.bullets = refit.slots.bullets
      if (refit.slots.caption) lastSlide.caption = refit.slots.caption
      lastSlide.layoutType = refit.layoutType
      lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
        .filter(Boolean)
        .join(' ')
      await lastSlide.save()
      await linkSegment('refit', lastSlide._id)
      await touchDeck(deck._id)
      if (!lastSlide.imageRef)
        maybeEnrich(
          lastSlide._id.toString(),
          layoutHasImageSlot(refit.layoutType, descriptors)
            ? refit.imageGuidance
            : undefined,
          [...assets.project, ...assets.deck],
          imageContext(
            {
              title: lastSlide.title,
              body: lastSlide.body,
              bullets: lastSlide.bullets,
              caption: lastSlide.caption,
              imageKeywords: lastSlide.imageKeywords,
              layoutType: refit.layoutType,
            },
            'fill',
          ),
          imageSlotNames(refit.layoutType, descriptors),
        )
      return event({ kind: 'slide.update', slide: toSlideDto(lastSlide) })
    }

    let result = rawResult

    // The current slide is a header (title/section): it introduces, it does not
    // accumulate. An update carrying real content (body/bullets) — whether a
    // plain delta or a refit that fell through above — would be invisible on
    // the header, so it becomes a NEW slide, leaving the header intact. A
    // title/caption-only update still refines the header in place.
    if (
      result.action === 'update' &&
      lastSlide &&
      isHeaderLayout(lastSlide.layoutType, descriptors) &&
      (result.slots.body || result.slots.bullets?.length)
    ) {
      result = {
        ...result,
        action: 'new',
        slots: {
          ...result.slots,
          title: result.slots.title || titleFromPhrase(input.phrase),
        },
      }
    }

    // Capacity enforcement (never trust the model): an update that
    // would overflow the slide's word budget becomes a NEW slide, and
    // new-slide content is clamped to the budget
    if (
      result.action === 'update' &&
      lastSlide &&
      result.layoutType !== lastSlide.layoutType &&
      // Marked slides and heading slides pin their layout; otherwise a switch
      // is only kept when it hides no displayed content (and refit is on).
      (keepLayout ||
        pinLayout ||
        !env.GENERATION_LAYOUT_REFIT ||
        !layoutDisplaysContent(
          result.layoutType,
          {
            title: lastSlide.title,
            body: lastSlide.body,
            bullets: lastSlide.bullets,
            caption: lastSlide.caption,
            hasImage: Boolean(lastSlide.imageRef),
          },
          descriptors,
        ))
    ) {
      // Delta layout switches may not hide displayed content (and are
      // disabled entirely when the flag is off, the slide is marked up, or it
      // is a heading slide): keep the layout
      result = { ...result, layoutType: lastSlide.layoutType }
    }
    if (
      result.action === 'update' &&
      lastSlide &&
      updateOverflows(
        result,
        {
          bulletCount: lastSlide.bullets?.length ?? 0,
          bodyChars: charCount(lastSlide.body),
        },
        descriptors,
      )
    ) {
      result = {
        ...result,
        action: 'new',
        slots: {
          ...result.slots,
          title: result.slots.title || titleFromPhrase(input.phrase),
        },
      }
    }
    // The current slide is a blank whiteboard canvas (no text slots): folding
    // content into it would be invisible, so a phrase that would update it
    // becomes a new slide instead. Filler ('none', handled above) still just
    // joins its transcript.
    if (
      result.action === 'update' &&
      lastSlide?.layoutType === WHITEBOARD_LAYOUT_TYPE
    ) {
      result = {
        ...result,
        action: 'new',
        slots: {
          ...result.slots,
          title: result.slots.title || titleFromPhrase(input.phrase),
        },
      }
    }
    // Whiteboard drawing is active on the client (WB-3): a new slide would
    // interrupt annotating, so append this phrase to the current slide as
    // transcript only (no content change) rather than creating one. Keeps the
    // slide's narration growing so stroke anchors stay correct. The "+" button
    // and the "new slide" voice command bypass this action, so explicit slide
    // creation still works. With no current slide there is nothing to append
    // to, so a slide is created as usual.
    if (input.suppressNewSlide && result.action === 'new' && lastSlide) {
      lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
        .filter(Boolean)
        .join(' ')
      await lastSlide.save()
      await linkSegment('update', lastSlide._id)
      await touchDeck(deck._id)
      return event({ kind: 'slide.update', slide: toSlideDto(lastSlide) })
    }

    // Honor image intent by giving it a layout that can show the image
    // (GEN-7): if the model asked for a photo on a layout without an
    // image slot, upgrade to one that fits — or drop the image if none
    // can, so no invisible, orphaned image is ever stored.
    if (result.action === 'new')
      result = clampToBudget(
        reconcileImageLayout(result, descriptors),
        descriptors,
      )
    if (result.action === 'update' && lastSlide) {
      // Additive update (GEN-8): new bullets slot in, body extends,
      // layout may re-fit. Body/bullets are the accumulating record and are
      // never rewritten — only extended.
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
      // Title/caption are headings, not accumulating content: a fresh value
      // OVERWRITES in place (e.g. a sharper title as the topic clarifies), so a
      // header slide's slot content stays current. Empty slots leave the
      // existing heading intact.
      if (result.slots.title) lastSlide.title = result.slots.title
      if (result.slots.caption) lastSlide.caption = result.slots.caption
      // Keep the layout fixed while the user is drawing on this slide, or if it
      // already carries marks (WB-1/WB-3), regardless of what the model
      // returned — the slide must not be rearranged under their strokes.
      if (!keepLayout) lastSlide.layoutType = result.layoutType
      // A box the author named holds one thing — a listing, a formula, a
      // table — so a fresh value REPLACES it. Appending a second program to
      // the first would produce something that no longer runs.
      //
      // Filtered against the layout the slide ACTUALLY kept, which is not
      // always the one the model wrote for (GEN-11).
      for (const [name, value] of Object.entries(
        onlyDeclaredBy(result.declared, lastSlide.layoutType, descriptors),
      )) {
        lastSlide.slots = { ...(lastSlide.slots ?? {}), [name]: value }
      }
      // Keep the slide's image keywords current: a phrase that carries fresh
      // image guidance replaces them, so the search seed and enrichment
      // always reflect the slide's latest content. An update with no
      // keywords leaves the existing ones intact.
      if (result.imageGuidance?.keywords?.length) {
        lastSlide.imageKeywords = result.imageGuidance.keywords
      }
      lastSlide.sourceTranscript = [lastSlide.sourceTranscript, input.phrase]
        .filter(Boolean)
        .join(' ')
      await lastSlide.save()
      await linkSegment('update', lastSlide._id)
      await touchDeck(deck._id)
      if (!lastSlide.imageRef)
        maybeEnrich(
          lastSlide._id.toString(),
          layoutHasImageSlot(lastSlide.layoutType, descriptors)
            ? result.imageGuidance
            : undefined,
          [...assets.project, ...assets.deck],
          imageContext(
            {
              title: lastSlide.title,
              body: lastSlide.body,
              bullets: lastSlide.bullets,
              caption: lastSlide.caption,
              imageKeywords: lastSlide.imageKeywords,
              layoutType: lastSlide.layoutType,
            },
            'fill',
          ),
          imageSlotNames(lastSlide.layoutType, descriptors),
        )
      return event({ kind: 'slide.update', slide: toSlideDto(lastSlide) })
    }

    const slide = await SlideModel.create({
      deckId: deck._id,
      index: deck.slideOrder.length,
      layoutType: result.layoutType,
      title: result.slots.title,
      body: result.slots.body,
      bullets: result.slots.bullets,
      caption: result.slots.caption,
      // Boxes the template's author named, already checked against what the
      // layout declares (GEN-11). The conventional four are derived onto the
      // slot map by the model's own hook, so only these are set here.
      ...(result.declared ? { slots: result.declared } : {}),
      imageKeywords: result.imageGuidance?.keywords,
      sourceTranscript: input.phrase,
    })
    deck.slideOrder.push(slide._id.toString())
    // (transcript already appended above, for every phrase)
    await deck.save()
    await linkSegment('new', slide._id)
    maybeEnrich(
      slide._id.toString(),
      layoutHasImageSlot(slide.layoutType, descriptors)
        ? result.imageGuidance
        : undefined,
      [...assets.project, ...assets.deck],
      imageContext(
        {
          title: result.slots.title,
          body: result.slots.body,
          bullets: result.slots.bullets,
          caption: result.slots.caption,
          imageKeywords: result.imageGuidance?.keywords,
          layoutType: result.layoutType,
        },
        'replace',
      ),
      imageSlotNames(result.layoutType, descriptors),
    )
    return event({ kind: 'slide.new', slide: toSlideDto(slide) })
  },
})

const sharesOf = sharesOfAcl

/** Lecture-level AI freedom; null re-inherits the project's setting. */
export const deckSetGenerationFreedom = defineAction<
  DeckSetGenerationFreedomInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setGenerationFreedom',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    freedom: z.number().int().min(1).max(5).nullable(),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      deck.generationFreedom = input.freedom ?? undefined
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

/** Per-lecture Refine settings (GEN-4): the on/off toggles and slider levels.
 * For each field a value sets it, null re-inherits the default, and absent
 * leaves it unchanged. These persist so the single-slide "Refine this slide"
 * action can reuse the lecture's choices. */
export const deckSetRefineSettings = defineAction<
  DeckSetRefineSettingsInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setRefineSettings',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    identifySpeakers: z.boolean().nullable().optional(),
    slidesEnabled: z.boolean().nullable().optional(),
    slidesLevel: z.number().int().min(1).max(5).nullable().optional(),
    transcriptEnabled: z.boolean().nullable().optional(),
    transcriptLevel: z.number().int().min(1).max(5).nullable().optional(),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      if (input.identifySpeakers !== undefined)
        deck.refineIdentifySpeakers = input.identifySpeakers ?? undefined
      if (input.slidesEnabled !== undefined)
        deck.refineSlidesEnabled = input.slidesEnabled ?? undefined
      if (input.slidesLevel !== undefined)
        deck.refineSlidesLevel = input.slidesLevel ?? undefined
      if (input.transcriptEnabled !== undefined)
        deck.refineTranscriptEnabled = input.transcriptEnabled ?? undefined
      if (input.transcriptLevel !== undefined)
        deck.refineTranscriptLevel = input.transcriptLevel ?? undefined
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

/** Lecture-level language; null re-inherits project/profile/browser. */
export const deckSetLanguage = defineAction<
  DeckSetLanguageInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setLanguage',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    language: z.enum(LOCALES).nullable(),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      deck.language = input.language ?? undefined
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

/** Lecture-level narration voice; null re-inherits the project's. */
export const deckSetTtsVoice = defineAction<
  DeckSetTtsVoiceInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setTtsVoice',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    voice: ttsVoiceIdSchema.nullable(),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      deck.ttsVoice = input.voice ?? undefined
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

export const deckSetSeedNotes = defineAction<
  DeckSetSeedNotesInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setSeedNotes',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    seedContext: z.string().max(20_000),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      deck.seedContext = input.seedContext
      await deck.save()
      return toDeckDto(deck, acl)
    }),
})

export const deckSetAccess = defineAction<
  DeckSetAccessInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.setAccess',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: async (ctx, input, access) => {
    // Same gate as a project's (AUTH-3): an unconfirmed account may share a
    // lecture with named people, but not with everyone.
    if (input.visibility === 'public' && ctx.userId) {
      await requireVerifiedEmail(ctx.userId)
    }
    return withDeckSettingsAudit(access, async (deck, acl) => {
      ensureDeckOverride(deck, acl)
      deck.accessOverride!.visibility = input.visibility
      deck.markModified('accessOverride')
      await deck.save()
      return toDeckDto(deck, resolveDeckAcl(deck, null))
    })
  },
})

/** Drops the lecture's override so it follows its project again. */
export const deckResetAccess = defineAction<
  DeckResetAccessInput,
  Deck,
  DeckSettingsAccess
>({
  name: 'deck.resetAccess',
  access: settingsOf,
  input: z.object({ deckId: z.string().min(1) }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async deck => {
      deck.accessOverride = undefined
      deck.markModified('accessOverride')
      await deck.save()
      return toDeckDto(deck, await loadDeckAcl(deck))
    }),
})

export const deckShare = defineAction<
  DeckShareInput,
  DeckShare[],
  DeckSettingsAccess
>({
  name: 'deck.share',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    email: z.email(),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
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
      ensureDeckOverride(deck, acl)
      const override = deck.accessOverride!
      const list = input.role === 'editor' ? override.editors : override.viewers
      if (!list.includes(userId)) list.push(userId)
      // One role per user: granting one revokes the other
      const other =
        input.role === 'editor' ? override.viewers : override.editors
      const index = other.indexOf(userId)
      if (index >= 0) other.splice(index, 1)
      deck.markModified('accessOverride')
      await deck.save()
      return sharesOf(resolveDeckAcl(deck, null))
    }),
})

export const deckUnshare = defineAction<
  DeckUnshareInput,
  DeckShare[],
  DeckSettingsAccess
>({
  name: 'deck.unshare',
  access: settingsOf,
  input: z.object({
    deckId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input, access) =>
    withDeckSettingsAudit(access, async (deck, acl) => {
      ensureDeckOverride(deck, acl)
      const override = deck.accessOverride!
      const list = input.role === 'editor' ? override.editors : override.viewers
      const index = list.indexOf(input.userId)
      if (index >= 0) list.splice(index, 1)
      deck.markModified('accessOverride')
      await deck.save()
      return sharesOf(resolveDeckAcl(deck, null))
    }),
})

/**
 * Who a lecture is shared with. A read: it takes the settings gate because
 * the share list is management data, but it changes nothing and so files no
 * settings-change entry (TECH-14).
 */
export const deckShares = defineAction<
  DeckSharesInput,
  DeckShare[],
  DeckAccess
>({
  name: 'deck.shares',
  access: settingsReadOf,
  input: z.object({ deckId: z.string().min(1) }),
  execute: (ctx, input, { acl }) => sharesOf(acl),
})

export const deckDelete = defineAction<
  DeckDeleteInput,
  { deleted: true },
  DeckAccess
>({
  name: 'deck.delete',
  access: ownerOf,
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck }) => {
    // Cascade: slides, lecture-level seed assets (and their stored
    // files), transcripts, refine jobs, retained recordings, then the
    // deck itself
    await deleteDeckCascade(deck)
    return { deleted: true }
  },
})

export const deckTransferOwnership = defineAction<
  DeckTransferOwnershipInput,
  Deck,
  DeckAccess
>({
  name: 'deck.transferOwnership',
  access: ownerOf,
  input: z.object({
    deckId: z.string().min(1),
    userId: z.string().min(1),
  }),
  execute: async (ctx, input, { userId, deck }) => {
    const target = await UserModel.findById(input.userId).catch(() => null)
    if (!target) {
      throw new ActionValidationError('deck.transferOwnership', [
        'userId: no such user',
      ])
    }
    const targetId = target._id.toString()
    if (targetId === userId) {
      throw new ActionValidationError('deck.transferOwnership', [
        'userId: already the owner',
      ])
    }
    const acl = await loadDeckAcl(deck)
    const before = deckSettingsSnapshot(deck, acl)
    // Transfers pin an override: the old owner's continued edit access
    // must not depend on the project's (their own) settings
    ensureDeckOverride(deck, acl)
    const override = deck.accessOverride!
    // The new owner leaves the people list; the old owner stays an editor
    override.viewers = override.viewers.filter(id => id !== targetId)
    override.editors = override.editors.filter(id => id !== targetId)
    if (!override.editors.includes(userId)) override.editors.push(userId)
    deck.ownerId = target._id
    deck.markModified('accessOverride')
    await deck.save()
    // Owner-only, so it never reaches editDeckSettings — it logs the
    // change itself. The entry is filed under whoever owns the lecture
    // now, so its history follows the settings.
    await recordSettingsChange({
      actorId: userId,
      actorRole: 'owner',
      entityType: 'deck',
      entityId: deck._id.toString(),
      entityName: deck.title,
      ownerId: targetId,
      before,
      after: deckSettingsSnapshot(deck, resolveDeckAcl(deck, null)),
    })
    // The caller is no longer the owner, so share lists stay behind
    return toSharedDeckDto(deck, resolveDeckAcl(deck, null))
  },
})

registerAction(deckCreate)
registerAction(deckList)
registerAction(deckGet)
registerAction(deckRename)
registerAction(deckSwitchTemplate)
registerAction(deckTemplateUpdateStatus)
registerAction(deckApplyTemplateUpdate)
registerAction(slideAdd)
registerAction(deckReorderSlides)
registerAction(sessionPhrase)
registerAction(deckSetSeedNotes)
registerAction(deckSetGenerationFreedom)
registerAction(deckSetRefineSettings)
registerAction(deckSetLanguage)
registerAction(deckSetTtsVoice)
registerAction(deckSetAccess)
registerAction(deckResetAccess)
registerAction(deckShare)
registerAction(deckUnshare)
registerAction(deckShares)
registerAction(deckDelete)
registerAction(deckTransferOwnership)
