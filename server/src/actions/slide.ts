/**
 * Slide actions (TECH-13). slide.get lets the client pick up
 * asynchronously-enriched images (IMG-1); slide.editContent and
 * slide.delete are the first EDIT-1 operations; slide.editTranscript edits the
 * spoken narration TTS reads (EDIT-6). Ownership is enforced through the
 * slide's deck; missing and foreign both read as forbidden.
 */
import { z } from 'zod'
import type {
  Slide,
  SlideDeleteInput,
  SlideEditDrawingsInput,
  SlideEditInput,
  SlideEditTranscriptInput,
  SlideRegenerateTranscriptInput,
  SlideRegenerateTranscriptResult,
  SlideSetLayoutInput,
  SlideRefitLayoutInput,
  SlideRefitLayoutResult,
  RefitSlotDescriptor,
  GenerationProvider,
  SlotLimits,
  SlotSpec,
  SlotValue,
} from '@slide-machine/shared'
import {
  pairSlots,
  slotLimits,
  textStylesBySlot,
  themeTextStyles,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { slideEditor, type SlideAccess } from './access'
import { registerAction, ActionValidationError } from './dispatch'
import { SlideModel, toSlideDto } from '../models/slide'
import { DeckModel, touchDeck } from '../models/deck'
import { resolveDeckTemplate } from '../templates/versions'
import { registry } from '../providers/registry'
import { requireAiTokens, requireCapacity } from '../billing/meter-hooks'
import {
  patchSlot,
  remapSlots,
  slotValueSchema,
  slotWriteOps,
  slotsOf,
} from '../lib/slide-slots'
import { remapSlideTranslations } from '../lib/translate-slides'
import {
  applyImageKeywords,
  emptyImageSlotsOf,
  sourceEmptyImageSlots,
} from '../lib/source-images'
import {
  applySlideTranscript,
  regenerateSlideTranscript,
} from '../lib/slide-transcript'
import { env } from '../config/env'

/** Every slide action is gated on its lecture; `pick` names the slide. */
const bySlideId = slideEditor((input: { slideId: string }) => input.slideId)

export const slideGet = defineAction<{ slideId: string }, Slide, SlideAccess>({
  name: 'slide.get',
  access: bySlideId,
  input: z.object({ slideId: z.string().min(1) }),
  execute: async (ctx, input, { slide }) => {
    return toSlideDto(slide)
  },
})

export const slideEditContent = defineAction<
  SlideEditInput,
  Slide,
  SlideAccess
>({
  name: 'slide.editContent',
  access: bySlideId,
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
    // Content keyed by slot name (TMPL-9/GEN-11). The names are the
    // template author's, so this is a map rather than named fields, and each
    // value declares the kind it carries.
    slots: z.record(z.string().min(1).max(60), slotValueSchema).optional(),
  }),
  execute: async (ctx, input, { slide }) => {
    // A hand-edit of any text content marks the slide as manually edited, so
    // the post-lecture reformat (GEN-4) won't overwrite it. Image-only changes
    // (imageRef/attribution) don't count — the reformat regenerates text, not
    // curated images.
    const editedContent =
      input.title !== undefined ||
      input.body !== undefined ||
      input.bullets !== undefined ||
      input.caption !== undefined ||
      // A custom text/bullet slot is hand-written content too; an image-only
      // patch is not, matching how imageRef is treated below.
      Object.values(input.slots ?? {}).some(v => v.kind !== 'image')
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
    // Slots merge one at a time, so editing one never clears another. A slot
    // the slide's layout does not declare is refused rather than stored: a
    // slide must never hold content the template cannot show.
    const deck = await DeckModel.findById(slide.deckId)
    const template = deck ? await resolveDeckTemplate(deck) : undefined
    if (input.slots) {
      const declared = new Set(
        template?.layouts
          .find(l => l.type === slide.layoutType)
          ?.slots.map(s => s.name) ?? [],
      )
      const unknown = Object.keys(input.slots).filter(n => !declared.has(n))
      if (unknown.length) {
        throw new ActionValidationError('slide.editContent', [
          `slots: not declared by this layout: ${unknown.join(', ')}`,
        ])
      }
    }

    // Content arriving on a layout with an empty picture box leaves a hole
    // nothing else fills: a slide built straight through slide.add plus
    // slide.editContent -- every imported lecture -- never passes through the
    // layout switch that used to be the only thing to source one. Keywords are
    // mined only when the slide has none, so this fires once per slide and a
    // box the author deliberately emptied is not refilled behind them.
    await slide.save()

    /*
     * The boxes are written one path at a time, not as a whole map.
     *
     * `slotWriteOps` says why at length. In short: republishing every box on
     * the slide to change one of them loses whatever another request wrote in
     * between, and editing two boxes in quick succession is what filling in a
     * slide IS. Addressing `slots.<name>` leaves the boxes this request never
     * mentioned exactly as they are, whoever else is writing them.
     */
    let written = slide
    if (input.slots) {
      const set: Record<string, unknown> = {}
      const unset: Record<string, ''> = {}
      const current = slotsOf(slide)
      for (const [name, value] of Object.entries(input.slots)) {
        const ops = slotWriteOps(current, name, value)
        Object.assign(set, ops.set)
        Object.assign(unset, ops.unset)
      }
      const update: Record<string, unknown> = {}
      if (Object.keys(set).length) update.$set = set
      if (Object.keys(unset).length) update.$unset = unset
      written =
        (await SlideModel.findOneAndUpdate({ _id: slide._id }, update, {
          new: true,
        })) ?? slide
    }
    await touchDeck(written.deckId)

    // Content arriving on a layout with an empty picture box leaves a hole
    // nothing else fills: a slide built straight through slide.add plus
    // slide.editContent -- every imported lecture -- never passes through the
    // layout switch that used to be the only thing to source one. Keywords are
    // mined only when the slide has none, so this fires once per slide and a
    // box the author deliberately emptied is not refilled behind them.
    //
    // Read from the slide as it stands AFTER the write, not before: which
    // picture boxes are still empty is a question about the slide that now
    // exists.
    const sourceImages =
      env.IMAGE_ENRICHMENT_ENABLED &&
      deck !== null &&
      template !== undefined &&
      emptyImageSlotsOf(written, template).length > 0
    if (sourceImages && applyImageKeywords(written).length) {
      await written.save()
      sourceEmptyImageSlots(written, deck!, template!)
    }

    return toSlideDto(written)
  },
})

/** Per-slide layout switch (EDIT-3): the target must be one of the
 * deck template's layouts; slot content is preserved as-is. Moving onto an
 * image-capable layout with no image yet kicks off background enrichment
 * (IMG-1) so the empty image slot fills itself. */
export const slideSetLayout = defineAction<
  SlideSetLayoutInput,
  Slide,
  SlideAccess
>({
  name: 'slide.setLayout',
  access: bySlideId,
  input: z.object({
    slideId: z.string().min(1),
    layoutType: z.string().min(1),
  }),
  execute: async (ctx, input, { slide, deck }) => {
    const template = await resolveDeckTemplate(deck)
    if (!template?.layouts.some(l => l.type === input.layoutType)) {
      throw new ActionValidationError('slide.setLayout', [
        'layoutType: not a layout of this template',
      ])
    }
    // Carry the content onto the new layout's boxes before the switch (GEN-9).
    // Layouts that share the conventional slot names pair name-for-name and
    // nothing moves; layouts that name their boxes differently pair on what
    // each box holds, so a heading stays a heading instead of being stranded
    // under a name the new layout never declares. `pairSlots` is shared with
    // the client's transition animation so the two cannot disagree about
    // which box became which.
    const fromLayout = template.layouts.find(l => l.type === slide.layoutType)
    const toLayout = template.layouts.find(l => l.type === input.layoutType)!
    if (fromLayout && fromLayout.type !== toLayout.type) {
      const { pairs } = pairSlots(fromLayout, toLayout)
      const before = slotsOf(slide)
      slide.slots = remapSlots(before, pairs)
      slide.markModified('slots')
      // The words did not change, only the box they sit in — carry any cached
      // translations across with them rather than paying to translate the
      // same text again (SHARE-2).
      await remapSlideTranslations(deck._id, slide._id.toString(), pairs, {
        id: slide._id.toString(),
        slots: before,
      })
    }

    slide.layoutType = input.layoutType

    // Switching onto a layout with picture boxes still empty: source them via
    // enrichment, so the empty image slot fills itself.
    if (
      env.IMAGE_ENRICHMENT_ENABLED &&
      emptyImageSlotsOf(slide, template).length
    )
      applyImageKeywords(slide)

    await slide.save()
    await touchDeck(slide.deckId)
    sourceEmptyImageSlots(slide, deck, template)

    return toSlideDto(slide)
  },
})

/** The text a slot holds, in the shape the refit request describes it. */
const refitValueOf = (
  value: SlotValue | undefined,
): string | string[] | undefined => {
  if (!value) return undefined
  if (value.kind === 'text' || value.kind === 'preformatted') return value.value
  if (value.kind === 'bullets') return value.items
  if (value.kind === 'code') return value.source
  if (value.kind === 'math') return value.tex
  return undefined
}

/**
 * One box, described for the refit request: its spec plus what it holds.
 *
 * `limits` are the resolved ones (`slotLimits`), not the box's own: a
 * built-in layout states its capacity through its text styles and its
 * constraints, so reading only the box would tell the model a title box has
 * no limit at all and invite one that overflows.
 */
const refitSlot = (
  spec: SlotSpec,
  textStyle: string | undefined,
  value: SlotValue | undefined,
  limits: SlotLimits | undefined,
): RefitSlotDescriptor => ({
  name: spec.name,
  kind: spec.kind,
  label: spec.label,
  textStyle,
  maxChars: limits?.maxChars,
  maxItems: limits?.maxItems,
  value: refitValueOf(value),
})

/**
 * slide.refitLayout — writes content for the boxes a layout switch left
 * empty (GEN-9).
 *
 * NOT the GEN-8 "layout re-fit" (GENERATION_LAYOUT_REFIT), which is the
 * model choosing a different layout for a slide it is updating mid-lecture
 * and rewriting the whole thing. This runs after the USER switched the
 * layout by hand, and only fills what that switch left empty.
 *
 * Deliberately narrow. `slide.setLayout` has already carried every box that
 * paired across, untouched; this asks the model only for the holes, with the
 * content the old layout had nowhere to put as its source. Two consequences
 * worth keeping: text the user wrote by hand is never rewritten, and a
 * switch between layouts that pair cleanly — every built-in pair does —
 * makes no AI call at all and returns the slide as it stands.
 */
export const slideRefitLayout = defineAction<
  SlideRefitLayoutInput,
  SlideRefitLayoutResult,
  SlideAccess
>({
  name: 'slide.refitLayout',
  access: bySlideId,
  meter: requireAiTokens,
  input: z.object({
    slideId: z.string().min(1),
    fromLayoutType: z.string().min(1).optional(),
  }),
  execute: async (ctx, input, { slide, deck }) => {
    const template = await resolveDeckTemplate(deck)
    const layout = template?.layouts.find(l => l.type === slide.layoutType)
    const unchanged = { slide: toSlideDto(slide), filled: [] as string[] }
    if (!template || !layout) return unchanged

    const content = slotsOf(slide)
    const declared = new Set(layout.slots.map(s => s.name))

    // A hole is a box this layout declares and nothing filled. Pictures are
    // excluded: they are sourced by image enrichment, not written by a
    // language model.
    const holes = layout.slots.filter(
      s => s.kind !== 'image' && refitValueOf(content[s.name]) === undefined,
    )
    // Content the switch could not place: the material to write the holes
    // from. Anything stored under a name this layout does not declare.
    const orphanNames = Object.keys(content).filter(n => !declared.has(n))
    if (!holes.length || !orphanNames.length) return unchanged

    const styles = themeTextStyles(template.theme)
    const toStyles = textStylesBySlot(layout)
    const toLimits = slotLimits(layout, styles)
    const from = input.fromLayoutType
      ? template.layouts.find(l => l.type === input.fromLayoutType)
      : undefined
    const fromStyles = from ? textStylesBySlot(from) : {}
    const fromLimits = from ? slotLimits(from, styles) : {}

    const orphaned = orphanNames
      .map(name => {
        const spec = from?.slots.find(s => s.name === name) ?? {
          name,
          kind: (content[name]?.kind === 'bullets' ? 'bullets' : 'text') as
            'bullets' | 'text',
          label: name,
        }
        return refitSlot(
          spec,
          fromStyles[name],
          content[name],
          fromLimits[name],
        )
      })
      .filter(s => s.value !== undefined)
    if (!orphaned.length) return unchanged

    const gen = registry.get<GenerationProvider>('generation')
    const result = await gen.refitSlideLayout({
      from: {
        layoutType: from?.type ?? input.fromLayoutType ?? 'unknown',
        label: from?.label ?? input.fromLayoutType ?? 'the previous layout',
        slots: (from?.slots ?? []).map(spec =>
          refitSlot(
            spec,
            fromStyles[spec.name],
            content[spec.name],
            fromLimits[spec.name],
          ),
        ),
      },
      to: {
        layoutType: layout.type,
        label: layout.label,
        purpose: layout.purpose,
        slots: layout.slots.map(spec =>
          refitSlot(
            spec,
            toStyles[spec.name],
            content[spec.name],
            toLimits[spec.name],
          ),
        ),
      },
      fill: holes.map(s => s.name),
      orphaned,
      language: deck.language,
      seedContext: { deck: deck.seedContext },
    })

    // Only the holes, and only in the shape the box holds. A reply naming any
    // other box is dropped rather than trusted: everything else on this slide
    // was carried over intact and must stay that way.
    const byName = new Map(holes.map(s => [s.name, s]))
    let next = content
    const filled: string[] = []
    for (const [name, value] of Object.entries(result.slots)) {
      const spec = byName.get(name)
      if (!spec) continue
      if (spec.kind === 'bullets') {
        const items = (Array.isArray(value) ? value : [value])
          .map(v => String(v).trim())
          .filter(Boolean)
        if (!items.length) continue
        next = patchSlot(next, name, { kind: 'bullets', items })
      } else {
        const text = (
          Array.isArray(value) ? value.join(' ') : String(value)
        ).trim()
        if (!text) continue
        next = patchSlot(next, name, { kind: 'text', value: text })
      }
      filled.push(name)
    }
    if (!filled.length) return unchanged

    slide.slots = next
    slide.markModified('slots')
    await slide.save()
    await touchDeck(slide.deckId)
    return { slide: toSlideDto(slide), filled }
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
export const slideEditDrawings = defineAction<
  SlideEditDrawingsInput,
  Slide,
  SlideAccess
>({
  name: 'slide.editDrawings',
  access: bySlideId,
  input: z.object({
    slideId: z.string().min(1),
    drawings: z.array(strokeInput).max(MAX_STROKES_PER_SLIDE),
  }),
  execute: async (ctx, input, { slide }) => {
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
  Slide,
  SlideAccess
>({
  name: 'slide.editTranscript',
  access: bySlideId,
  input: z.object({
    slideId: z.string().min(1),
    // Empty is allowed: it clears the stored narration, so playback falls back
    // to narrating the slide's own content (PLAY-2).
    transcript: z.string().max(MAX_TRANSCRIPT_CHARS),
  }),
  execute: async (ctx, input, { slide }) => {
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
  SlideRegenerateTranscriptResult,
  SlideAccess
>({
  name: 'slide.regenerateTranscript',
  access: bySlideId,
  // Metered against the transcription allowance, not the AI one: this
  // re-transcribes retained audio, which is priced as streaming speech.
  //
  // The hook was omitted until now because the access check lived inside
  // execute and dispatch ran meter first, so enforcing the cap would have
  // answered someone with no rights to the lecture with a billing error. The
  // declaration above fixes the order, so the minutes counted in
  // transcribeAudio are finally enforced as well as recorded (TECH-14).
  meter: requireCapacity(
    'sttMinutes',
    'You have used all of this billing period’s transcription. It resets at the start of your next period.',
  ),
  input: z.object({
    slideId: z.string().min(1),
    save: z.boolean().optional(),
  }),
  execute: async (ctx, input, { slide, deck }) => {
    const { transcript, saved } = await regenerateSlideTranscript(deck, slide, {
      save: input.save,
    })
    return { transcript, ...(saved ? { slide: toSlideDto(slide) } : {}) }
  },
})

export const slideDelete = defineAction<
  SlideDeleteInput,
  { deleted: true; slideOrder: string[] },
  SlideAccess
>({
  name: 'slide.delete',
  access: bySlideId,
  input: z.object({ slideId: z.string().min(1) }),
  execute: async (ctx, input, { slide, deck }) => {
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
registerAction(slideRefitLayout)
registerAction(slideDelete)
