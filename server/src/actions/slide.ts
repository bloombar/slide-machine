/**
 * Slide actions (TECH-13). slide.get lets the client pick up
 * asynchronously-enriched images (IMG-1); slide.editContent and
 * slide.delete are the first EDIT-1 operations; slide.editTranscript edits the
 * spoken narration TTS reads (EDIT-6). Ownership is enforced through the
 * slide's deck; missing and foreign both read as forbidden.
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  LayoutType,
  Slide,
  SlideDeleteInput,
  SlideEditDrawingsInput,
  SlideEditInput,
  SlideEditTranscriptInput,
  SlideRegenerateTranscriptInput,
  SlideRegenerateTranscriptResult,
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
import { resolveTemplate } from '../templates/resolve'
import { canEditAcl } from '../lib/access'
import { layoutHasImageSlot } from '../lib/image-layout'
import { enrichSlideImage } from '../enrichment/enrich'
import type { SlideImageContext } from '../enrichment/types'
import { deriveImageKeywords } from '../enrichment/keywords'
import { seedAssetsFor, seededImageCandidates } from '../lib/seed-assets'
import {
  applySlideTranscript,
  regenerateSlideTranscript,
} from '../lib/slide-transcript'
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
    // A hand-edit of any text content marks the slide as manually edited, so
    // the post-lecture reformat (GEN-4) won't overwrite it. Image-only changes
    // (imageRef/attribution) don't count — the reformat regenerates text, not
    // curated images.
    const editedContent =
      input.title !== undefined ||
      input.body !== undefined ||
      input.bullets !== undefined ||
      input.caption !== undefined
    if (editedContent) slide.manuallyEdited = true
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
    const template = await resolveTemplate(deck.templateId)
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
      // 'fill' captioning: this slide may already carry an edited caption, so
      // only set one when it is empty (the AI re-rank still picks the image).
      const context: SlideImageContext = {
        title: slide.title,
        body: slide.body,
        bullets: slide.bullets,
        caption: slide.caption,
        imageKeywords: keywords,
        layoutType: input.layoutType,
        captionMaxChars: template.layouts
          .find(l => l.type === input.layoutType)
          ?.slots.find(s => s.name === 'caption')?.maxChars,
        seedContext: deck.seedContext?.slice(0, 1500) || undefined,
        captionMode: 'fill',
      }
      void seedAssetsFor(deck)
        .then(assets =>
          enrichSlideImage(
            slideId,
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

    return toSlideDto(slide)
  },
})

// Defensive caps so a runaway client can't bloat a slide document (WB-1).
const MAX_STROKES_PER_SLIDE = 2000
const MAX_POINTS_PER_STROKE = 10000

// The phrase fingerprint (`phraseText`/`phraseOffset`) and `orphaned` are part
// of the durable anchor (WB-2) and MUST round-trip: the client re-sends the
// whole stroke set on every draw, so anything missing here is silently stripped
// and a later transcript rewrite loses its semantic re-anchoring.
const anchorInput = z.object({
  charAnchor: z.number().int().min(0),
  source: z.enum(['word', 'appended', 'elapsed', 'unsynced']),
  sessionId: z.string().optional(),
  sessionMs: z.number().optional(),
  phraseText: z.string().optional(),
  phraseOffset: z.number().min(0).max(1).optional(),
  orphaned: z.boolean().optional(),
})

const strokeInput = z.object({
  id: z.string().min(1),
  tool: z.enum(['pen', 'highlighter']),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'color must be a hex value'),
  thickness: z.number().positive(),
  points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .min(1)
    .max(MAX_POINTS_PER_STROKE),
  startedAt: z.string(),
  endedAt: z.string(),
  anchor: anchorInput,
  erasedAnchor: anchorInput.optional(),
  erasedAt: z.string().optional(),
})

/** Clamps a normalized coordinate into the slide box; strokes are stored 0..1. */
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Replaces a slide's whiteboard drawings (WB-1). The client owns the full
 * stroke set (draw + timestamped erase) and sends it wholesale after each
 * change; this is last-write-wins like slide.editContent. Does NOT set
 * manuallyEdited — that flag guards text against the reformat, not drawings.
 */
export const slideEditDrawings = defineAction<SlideEditDrawingsInput, Slide>({
  name: 'slide.editDrawings',
  input: z.object({
    slideId: z.string().min(1),
    drawings: z.array(strokeInput).max(MAX_STROKES_PER_SLIDE),
  }),
  execute: async (ctx, input) => {
    const { slide } = await loadOwnedSlide(ctx, input.slideId)
    slide.drawings = input.drawings.map(s => ({
      ...s,
      points: s.points.map(p => ({ x: clamp01(p.x), y: clamp01(p.y) })),
    }))
    await slide.save()
    await touchDeck(slide.deckId)
    return toSlideDto(slide)
  },
})

/** Generous cap on a hand-written narration, so one slide can't be turned into
 * an unbounded document. A spoken narration is a handful of sentences. */
const MAX_TRANSCRIPT_CHARS = 20000

/**
 * Replaces a slide's spoken narration — the text TTS reads during playback
 * (EDIT-6, kebab "Edit spoken transcript").
 *
 * Whiteboard marks are timed by character offsets into this very text (WB-2),
 * so overwriting it blind would strand every mark. The write therefore goes
 * through the shared `applySlideTranscript`, which re-anchors each mark onto the
 * new wording (see lib/slide-transcript).
 */
export const slideEditTranscript = defineAction<
  SlideEditTranscriptInput,
  Slide
>({
  name: 'slide.editTranscript',
  input: z.object({
    slideId: z.string().min(1),
    // Empty is allowed: it clears the stored narration, so playback falls back
    // to narrating the slide's own content (PLAY-2).
    transcript: z.string().max(MAX_TRANSCRIPT_CHARS),
  }),
  execute: async (ctx, input) => {
    const { slide } = await loadOwnedSlide(ctx, input.slideId)
    await applySlideTranscript(slide, input.transcript)
    return toSlideDto(slide)
  },
})

/**
 * slide.regenerateTranscript — re-transcribes a slide from the lecture audio
 * retained for it (GEN-4), the "Regenerate from spoken audio" action in the
 * transcript editor. By default the text is only returned, so the user reviews
 * it in the editor and saves (or discards) it themselves; `save: true` writes it
 * straight to the slide, which is what a regenerate-every-slide pass wants.
 *
 * The work itself lives in lib/slide-transcript so both callers — and any
 * future bulk pass — share one implementation.
 */
export const slideRegenerateTranscript = defineAction<
  SlideRegenerateTranscriptInput,
  SlideRegenerateTranscriptResult
>({
  name: 'slide.regenerateTranscript',
  // No `meter` hook, deliberately. This action checks edit access *inside*
  // execute (loadEditableDeck), and dispatch runs meter before execute — so a
  // hook here would answer a user with no rights to the lecture with a billing
  // error instead of a 403. The minutes are still counted, in transcribeAudio;
  // enforcing them needs the access check lifted into an `authorize` hook
  // first, which is a wider refactor than this slice.
  input: z.object({
    slideId: z.string().min(1),
    save: z.boolean().optional(),
  }),
  execute: async (ctx, input) => {
    const { slide, deck } = await loadOwnedSlide(ctx, input.slideId)
    const { transcript, saved } = await regenerateSlideTranscript(deck, slide, {
      save: input.save,
    })
    return { transcript, ...(saved ? { slide: toSlideDto(slide) } : {}) }
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
    // Soft delete (P-10): tombstone the slide and drop it from the deck's order.
    slide.deletedAt = new Date()
    await slide.save()
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
registerAction(slideEditDrawings)
registerAction(slideEditTranscript)
registerAction(slideRegenerateTranscript)
registerAction(slideSetLayout)
registerAction(slideDelete)
