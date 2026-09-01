/**
 * Post-lecture reconciliation & refinement (GEN-4).
 *
 * - deck.diarize: run speaker diarization on the deck's recordings and tag its
 *   transcript segments with a speaker + lecturer/student role.
 * - deck.reformat: regenerate student/mixed slides so student turns read as
 *   questions, protecting lecturer-only / hand-edited / manually-added slides.
 * - deck.refine / deck.refineStatus: the "Refine" surface — run any of three
 *   passes (identify speakers, refine slide content, refine spoken narration)
 *   as ONE background job, keeping the TTS narration in-line with the resulting
 *   slide content. Long jobs (diarization is a minutes-long batch) never block
 *   the request: deck.refine returns a jobId the client polls with refineStatus.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { narratableText } from '../lib/narratable'
import type { HydratedDocument } from 'mongoose'
import type {
  DeckDiarizeInput,
  DeckDiarizeResult,
  DeckReformatInput,
  DeckReformatResult,
  DeckRefineInput,
  DeckRefineResult,
  DeckRefineSlideInput,
  DeckRefineSlideResult,
  DeckRefineSlideTranscriptInput,
  DeckRefineSlideTranscriptResult,
  DeckRefineStatusInput,
  DeckRefineStatusResult,
  RefineJobProgress,
  DiarizationProvider,
  DiarizedSpeakerSegment,
  GenerationProvider,
  LayoutDescriptor,
  ReformatTurn,
  SlideContent,
  SlideRefineParts,
  SpeakerRole,
  Stroke,
  SlideSplitPart,
  DeckSplitSlideInput,
  DeckSplitSlideResult,
} from '@slide-machine/shared'
import { remapDrawingAnchors } from './remap-drawings'
import { applySlideTranscript } from '../lib/slide-transcript'
import { defineAction } from './define'
import { requireAiTokens, assertUserCapacity } from '../billing/meter-hooks'
import { currentUsageUser, meterUsage } from '../billing/usage-context'
import { registerAction, ActionForbiddenError } from './dispatch'
import { MAX_SPLIT_PARTS } from '@slide-machine/shared'
import { imageSearchTerms } from '../lib/source-images'
import {
  deckEditor,
  refineJobEditor,
  type DeckAccess,
  type RefineJobAccess,
} from './access'
import { env } from '../config/env'
import { registry } from '../providers/registry'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { SlideModel, toSlideDto, type SlideDb } from '../models/slide'
import { DeckModel, touchDeck, type DeckDb } from '../models/deck'
import { RefineJobModel } from '../models/refine-job'
import { layoutDescriptors } from '../templates/builtin'
import { resolveDeckTemplate } from '../templates/versions'
import { assignSpeakers } from '../lib/diarization-join'
import { mapSpeakerRoles } from '../lib/speaker-roles'
import { planReformat } from '../lib/reformat-plan'
import { imageSlotNames, layoutHasImageSlot } from '../lib/image-layout'
import { layoutDisplaysContent } from '../lib/layout-refit'
import { enrichSlideImages } from '../enrichment/enrich'
import type { SlideImageContext } from '../enrichment/types'
import { deriveImageKeywords } from '../enrichment/keywords'
import { seedAssetsFor, seededImageCandidates } from '../lib/seed-assets'

type DeckDoc = HydratedDocument<DeckDb>
type SlideDoc = HydratedDocument<SlideDb>

/** The slide's editable content, as the generation passes consume it. */
const contentOf = (s: SlideDoc): SlideContent => {
  // Boxes the author named carry prose too; what they hold that is not
  // language — a formula, a listing, a grid — is left out (EDIT-7).
  const spoken = narratableText(s.slots)
  return {
    layoutType: s.layoutType,
    title: s.title,
    body: s.body,
    bullets: s.bullets,
    caption: s.caption,
    ...(spoken.length ? { spoken } : {}),
  }
}

/** Writes a generation result's content back onto a slide (image + id kept). */
const applyContent = (
  s: SlideDoc,
  result: {
    layoutType: string
    slots: {
      title?: string
      body?: string
      bullets?: string[]
      caption?: string
    }
  },
): void => {
  s.layoutType = result.layoutType
  s.title = result.slots.title
  s.body = result.slots.body
  s.bullets = result.slots.bullets
  s.caption = result.slots.caption
}

/**
 * After a slide is refined, source an image when its layout has an image slot
 * but none is placed — whether it was already on such a layout or was refined
 * onto one. Reuses the same search → score → AI re-rank enrichment as every
 * other automatic image fetch (IMG-1/2). Awaited (this is already a background
 * job) so a finished refine leaves the images in place; failures are logged.
 */
const enrichRefinedSlideImage = async (
  slide: SlideDoc,
  guidanceKeywords: string[] | undefined,
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
): Promise<void> => {
  if (
    !env.IMAGE_ENRICHMENT_ENABLED ||
    slide.imageRef ||
    !layoutHasImageSlot(slide.layoutType, descriptors)
  )
    return

  // Keywords from the refine's own image guidance, else the slide's existing
  // ones, else derived from its text.
  let keywords = guidanceKeywords?.length
    ? guidanceKeywords
    : (slide.imageKeywords ?? [])
  if (!keywords.length) keywords = deriveImageKeywords(slide)
  if (!keywords.length) return

  slide.imageKeywords = keywords
  await slide.save()

  const context: SlideImageContext = {
    title: slide.title,
    body: slide.body,
    bullets: slide.bullets,
    caption: slide.caption,
    imageKeywords: keywords,
    layoutType: slide.layoutType,
    captionMaxChars: descriptors
      .find(d => d.type === slide.layoutType)
      ?.slots.find(s => s.name === 'caption')?.maxChars,
    seedContext: deck.seedContext?.slice(0, 1500) || undefined,
    captionMode: 'fill',
  }
  try {
    const assets = await seedAssetsFor(deck)
    await enrichSlideImages(
      slide._id.toString(),
      imageSlotNames(slide.layoutType, descriptors),
      keywords,
      [
        ...seededImageCandidates(assets.project),
        ...seededImageCandidates(assets.deck),
      ],
      context,
    )
  } catch (error) {
    console.error('Refine image enrichment failed for a slide:', error)
  }
}

/** Slide ids that any student-role segment points at — used to frame narration. */
const studentSlideIds = async (
  deckId: DeckDoc['_id'],
): Promise<Set<string>> => {
  const segs = await TranscriptSegmentModel.find({ deckId, role: 'student' })
  return new Set(segs.filter(s => s.slideId).map(s => s.slideId!.toString()))
}

/**
 * Stores one recording's speaker turns so later passes skip the paid call.
 * Targets the single subdocument by sessionId rather than saving the whole
 * deck, so a concurrent slide edit cannot be clobbered by a stale copy.
 */
const cacheDiarization = async (
  deck: DeckDoc,
  sessionId: string,
  diarization: DiarizedSpeakerSegment[],
  provider: string,
): Promise<void> => {
  await DeckModel.updateOne(
    { _id: deck._id, 'recordings.sessionId': sessionId },
    {
      $set: {
        'recordings.$.diarization': diarization,
        'recordings.$.diarizedBy': provider,
        'recordings.$.diarizedAt': new Date(),
      },
    },
  )
}

/**
 * Diarizes retained recordings and tags their segments with speaker + role.
 * `onlySessions` narrows the work to the recordings a single slide's speech
 * came from (the per-slide dialog); roles are still decided from each WHOLE
 * recording's talk-time, which is what makes "the lecturer is whoever talks
 * most" hold — on one slide's audio alone a student could out-talk the
 * lecturer.
 *
 * The diarizer's output is cached on the recording, so a repeat pass re-tags
 * from stored intervals and never re-bills the audio. That matters because
 * diarization costs the same per minute as capturing the lecture live, and
 * per-slide speaker identification calls this once per slide: on a 45-slide
 * lecture the uncached path submitted 45 full recordings.
 *
 * Minutes submitted count against `diarizationMinutes` (BILL-3), charged to
 * whoever's action this is — the same ambient attribution the AI tokens spent
 * in the surrounding reconcile use. Diarization is never audience-triggered
 * (every path into it needs edit rights), so the "the deck owner pays" rule
 * that governs viewer-caused work does not apply here.
 */
const diarizeDeckRecordings = async (
  deck: DeckDoc,
  onlySessions?: Set<string>,
): Promise<DeckDiarizeResult> => {
  const all = deck.recordings ?? []
  const recordings = onlySessions
    ? all.filter(r => onlySessions.has(r.sessionId))
    : all
  if (!recordings.length) return { sessionsProcessed: 0, segmentsTagged: 0 }

  // Absent outside a dispatched action (a background sweep, a seed script):
  // nobody asked for the work, so nobody's allowance pays for it.
  const payer = currentUsageUser()
  const provider = registry.get<DiarizationProvider>('diarization')
  const segments = await TranscriptSegmentModel.find({ deckId: deck._id })

  let sessionsProcessed = 0
  let segmentsTagged = 0
  for (const rec of recordings) {
    const sessionSegments = segments.filter(s => s.sessionId === rec.sessionId)
    if (!sessionSegments.length) continue

    // Reuse the stored intervals when the same engine produced them. The audio
    // is immutable once retained, so the only thing that can invalidate them is
    // a change of adapter — switching off the mock, above all.
    const cached =
      rec.diarizedBy === provider.name && rec.diarization?.length
        ? rec.diarization
        : undefined

    const minutes = rec.durationMs / 60_000
    if (cached) {
      // Recorded, never debited: re-tagging from stored intervals submits no
      // audio, but the pass still happened and the user is still active on this
      // metric (BILL-3).
      await meterUsage('diarizationMinutes', minutes, { billable: false })
    } else if (payer) {
      // Checked before the audio is submitted, so an exhausted allowance costs
      // nothing at all. Per recording rather than once for the deck: a lecture
      // with several recordings should stop at the cap, not sail past it.
      await assertUserCapacity(
        payer,
        'diarizationMinutes',
        'You have used all of this billing period’s speaker identification. It resets at the start of your next period.',
      )
    }

    const diarized =
      cached ??
      (await provider.diarize({
        audioKey: rec.audioKey,
        sampleRate: rec.sampleRate,
      }))
    // Metered on a result, not on the attempt: the adapter returns [] without
    // submitting anything when the audio or the staging bucket is missing, and
    // an unconfigured deployment must not bill for work it never sent.
    if (!cached && diarized.length) {
      await meterUsage('diarizationMinutes', minutes)
    }
    if (!diarized.length) continue
    if (!cached)
      await cacheDiarization(deck, rec.sessionId, diarized, provider.name)
    sessionsProcessed++

    const roleBySpeaker = mapSpeakerRoles(diarized)
    const speakerBySegment = assignSpeakers(
      sessionSegments.map(s => ({
        id: s._id.toString(),
        startMs: s.startMs,
        endMs: s.endMs,
        words: s.words,
      })),
      diarized,
    )
    for (const seg of sessionSegments) {
      const speaker = speakerBySegment.get(seg._id.toString())
      if (speaker == null) continue
      await TranscriptSegmentModel.updateOne(
        { _id: seg._id },
        { speaker, role: roleBySpeaker.get(speaker) },
      )
      segmentsTagged++
    }
  }
  return { sessionsProcessed, segmentsTagged }
}

/** The role-tagged speech turns per slide (diarized segments only), ordered by
 * capture time — the shared source for both the content reformat and the
 * narration attribution. A slide with no role-tagged segments is absent. */
const turnsBySlide = async (
  deckId: DeckDoc['_id'],
): Promise<Map<string, ReformatTurn[]>> => {
  const segments = await TranscriptSegmentModel.find({ deckId })
  const grouped = new Map<
    string,
    { role: SpeakerRole; text: string; at: number }[]
  >()
  for (const seg of segments) {
    if (!seg.slideId || !seg.role) continue
    const sid = seg.slideId.toString()
    const arr = grouped.get(sid) ?? []
    arr.push({
      role: seg.role as SpeakerRole,
      text: seg.text,
      at: seg.createdAt.getTime(),
    })
    grouped.set(sid, arr)
  }
  const out = new Map<string, ReformatTurn[]>()
  for (const [sid, arr] of grouped) {
    arr.sort((a, b) => a.at - b.at)
    out.set(
      sid,
      arr.map(({ role, text }) => ({ role, text })),
    )
  }
  return out
}

/** Stable hash of the inputs that determine a slide's narration, so an
 * unchanged diarized slide isn't re-narrated (and re-billed) on a repeated
 * Refine — the source of the narration's idempotency. */
const narrateHash = (
  turns: ReformatTurn[],
  level: number,
  language: string | undefined,
): string =>
  createHash('sha256')
    .update(JSON.stringify({ turns, level, language: language ?? '' }))
    .digest('hex')

/** Reformats student/mixed slides in place; returns counts + which slides now
 * represent student speech (so their narration is framed accordingly).
 * `onlySlideId` scopes the pass to one slide for the per-slide dialog — the
 * planning and reformatting are identical, just over a shorter list. */
const reformatStudentSlides = async (
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
  onlySlideId?: string,
): Promise<{
  reframed: number
  kept: number
  protectedCount: number
  studentSlideIds: Set<string>
}> => {
  const [allSlides, turnMap] = await Promise.all([
    SlideModel.find({ deckId: deck._id }).sort({ index: 1 }),
    turnsBySlide(deck._id),
  ])
  const slides = onlySlideId
    ? allSlides.filter(s => s._id.toString() === onlySlideId)
    : allSlides

  const rolesBySlide = new Map<string, SpeakerRole[]>(
    [...turnMap].map(([sid, ts]) => [sid, ts.map(t => t.role)]),
  )
  const plan = planReformat(
    slides.map(s => ({
      id: s._id.toString(),
      manuallyEdited: s.manuallyEdited,
    })),
    rolesBySlide,
  )
  const slideById = new Map(slides.map(s => [s._id.toString(), s]))

  const reframedIds = new Set<string>()
  let kept = 0
  let protectedCount = 0
  for (const p of plan) {
    if (p.decision === 'keep') {
      kept++
      continue
    }
    if (p.decision === 'protected') {
      protectedCount++
      continue
    }
    const slide = slideById.get(p.slideId)!
    const turns = turnMap.get(p.slideId) ?? []
    const result = await gen.reformatSlide({
      current: contentOf(slide),
      turns,
      layoutDescriptors: descriptors,
      language: deck.language,
      seedContext: { deck: deck.seedContext },
    })
    applyContent(slide, result)
    await slide.save()
    reframedIds.add(p.slideId)
  }
  if (reframedIds.size) await touchDeck(deck._id)
  return {
    reframed: reframedIds.size,
    kept,
    protectedCount,
    studentSlideIds: reframedIds,
  }
}

/** The content gate, shared by every refine/reformat action here. */
const byDeckId = deckEditor((input: { deckId: string }) => input.deckId)

export const deckDiarize = defineAction<
  DeckDiarizeInput,
  DeckDiarizeResult,
  DeckAccess
>({
  name: 'deck.diarize',
  access: byDeckId,
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck }) => {
    return diarizeDeckRecordings(deck)
  },
})

registerAction(deckDiarize)

export const deckReformat = defineAction<
  DeckReformatInput,
  DeckReformatResult,
  DeckAccess
>({
  name: 'deck.reformat',
  access: byDeckId,
  meter: requireAiTokens,
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck }) => {
    const template = await resolveDeckTemplate(deck)
    const descriptors = template ? layoutDescriptors(template) : []
    const gen = registry.get<GenerationProvider>('generation')
    const { reframed, kept, protectedCount } = await reformatStudentSlides(
      deck,
      descriptors,
      gen,
    )
    return { reformatted: reframed, kept, protectedCount }
  },
})

registerAction(deckReformat)

/** Refine everything about a slide — what an unqualified content pass means. */
const ALL_PARTS: Required<SlideRefineParts> = {
  text: true,
  layout: true,
  imagery: true,
}

/** Fills in the omitted parts as "yes", so callers can pass a partial (or
 * nothing) and get the whole-slide behavior. */
const resolveParts = (
  parts?: SlideRefineParts,
): Required<SlideRefineParts> => ({
  text: parts?.text ?? ALL_PARTS.text,
  layout: parts?.layout ?? ALL_PARTS.layout,
  imagery: parts?.imagery ?? ALL_PARTS.imagery,
})

/**
 * Refines one slide's content in place — the shared body of the whole-lecture
 * refine loop, the "Refine this slide" dialog, and anything later that refines
 * a slide. Hand-edited slides are protected (returns false, untouched).
 *
 * `parts` narrows what may change, and each part is honored at the point it can
 * be honored honestly:
 *  - text without layout: the model is offered ONLY the slide's current layout,
 *    so it writes to the slots (and budgets) the slide actually has.
 *  - layout without text: the model's layout is taken only if it still displays
 *    every populated slot (the same guard delta updates use, GEN-8) — a layout
 *    switch must never make committed content vanish.
 *  - imagery alone needs no generation call: enrichment falls back to the
 *    slide's own keywords, so nothing is billed for text that is discarded.
 */
/**
 * One slide, written as several (GEN-4) — the shared body of `deck.splitSlide`
 * and of a refine the instructor allowed to split.
 *
 * The FIRST part replaces the original slide, keeping its id. That is what
 * makes a split non-destructive in the ways that matter: its narration, its
 * whiteboard drawings, its transcript segments and anything else keyed to that
 * id stay attached to a slide that still exists. The rest are inserted
 * directly after it, and every slide below shifts down.
 *
 * Callers validate the parts before calling: at least two (fewer is not a
 * split) and no more than MAX_SPLIT_PARTS.
 */
interface AppliedSplit {
  /** The model's one-phrase reason, carried through so the instructor can be
   * told why their slide became several. Empty when there is no reason to
   * give (a hand-made split has none). */
  reason: string
  /** The original slide, re-read, now holding the first part. */
  first: SlideDoc
  /** The slides created after it, in order. */
  added: SlideDoc[]
  /** The deck's slide order after the insert. */
  slideOrder: string[]
}

const splitSlideIntoParts = async (
  deck: DeckDoc,
  slide: SlideDoc,
  parts: SlideSplitPart[],
  descriptors: LayoutDescriptor[],
  opts: { reason?: string } = {},
): Promise<AppliedSplit> => {
  const known = new Set(descriptors.map(d => d.type))
  // A layout this deck's design does not have would draw nothing. Falling
  // back to the slide's own layout keeps every part visible, which beats
  // refusing a split that was already agreed to.
  const layoutOf = (candidate: string): string =>
    known.has(candidate) ? candidate : slide.layoutType

  const [first, ...rest] = parts

  // The original keeps its id and takes the first part.
  applyContent(slide, {
    layoutType: layoutOf(first!.layoutType),
    slots: first!.slots,
  })
  // The part's own picture terms, so its box fills for what THIS part is
  // about rather than for what the undivided slide was.
  const firstTerms = imageSearchTerms(first!.imageGuidance, first!.slots)
  if (firstTerms.length) slide.imageKeywords = firstTerms
  await slide.save()

  const created: SlideDoc[] = []
  for (const part of rest) {
    const made = await SlideModel.create({
      deckId: deck._id,
      // Placed by slideOrder below; this is a provisional value.
      index: deck.slideOrder.length,
      layoutType: layoutOf(part.layoutType),
      title: part.slots.title,
      body: part.slots.body,
      bullets: part.slots.bullets,
      caption: part.slots.caption,
      imageKeywords: imageSearchTerms(part.imageGuidance, part.slots),
      // The words came from this slide, so the part answers for the same
      // stretch of speech. Without it a new part has no source material and
      // its narration would be written from the slide text alone.
      sourceTranscript: slide.sourceTranscript,
    })
    created.push(made)
  }

  // Insert directly after the original, then renumber: `index` has to agree
  // with position in slideOrder, which is what every other mutation of the
  // order does (slide.delete, deck.reorderSlides).
  const id = slide._id.toString()
  const at = deck.slideOrder.indexOf(id)
  const newIds = created.map(s => s._id.toString())
  deck.slideOrder =
    at === -1
      ? [...deck.slideOrder, ...newIds]
      : [
          ...deck.slideOrder.slice(0, at + 1),
          ...newIds,
          ...deck.slideOrder.slice(at + 1),
        ]
  await deck.save()
  await Promise.all(
    deck.slideOrder.map((sid, i) =>
      SlideModel.updateOne({ _id: sid }, { index: i }),
    ),
  )
  await touchDeck(deck._id)

  // Re-read so the results carry the indexes just written.
  const fresh = (await SlideModel.findById(slide._id)) ?? slide
  const addedFresh = await SlideModel.find({ _id: { $in: newIds } }).sort({
    index: 1,
  })
  return {
    reason: opts.reason?.trim() ?? '',
    first: fresh,
    added: addedFresh,
    slideOrder: deck.slideOrder,
  }
}

interface RefineOutcome {
  /** The slide was eligible and the pass ran (false for a hand-edited slide,
   * or when every part was switched off). */
  changed: boolean
  /** What happened when the slide was broken into several. Present only when
   * the caller allowed a split AND the model asked for one. */
  split?: AppliedSplit
}

const refineOneSlide = async (
  slide: SlideDoc,
  level: number,
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
  parts?: SlideRefineParts,
  allowSplit = false,
): Promise<RefineOutcome> => {
  if (slide.manuallyEdited) return { changed: false }
  const want = resolveParts(parts)
  if (!want.text && !want.layout && !want.imagery) return { changed: false }

  // Splitting is a claim about the WORDS — that they are two ideas, or more
  // than a slide can hold. A layout- or imagery-only refine never looked at
  // them, so it cannot make that claim and does not ask for one.
  const maySplit = allowSplit && want.text

  // Only the text/layout passes need the model; imagery-only skips the call.
  const offered = want.layout
    ? descriptors
    : descriptors.filter(d => d.type === slide.layoutType)
  const result =
    want.text || want.layout
      ? await gen.refineSlide({
          current: contentOf(slide),
          level,
          layoutDescriptors: offered,
          language: deck.language,
          seedContext: { deck: deck.seedContext },
          // The slide's current transcript as source material (original spoken
          // words on the first refine, previously-refined narration on later
          // ones).
          transcript: slide.sourceTranscript,
          allowSplit: maySplit,
        })
      : null

  if (result) {
    if (want.text && want.layout) {
      applyContent(slide, result)
    } else if (want.text) {
      // Layout is the user's; only the words change.
      applyContent(slide, { ...result, layoutType: slide.layoutType })
    } else if (
      layoutDisplaysContent(
        result.layoutType,
        // The image counts: a layout with no image slot would hide it.
        { ...contentOf(slide), hasImage: Boolean(slide.imageRef) },
        descriptors,
      )
    ) {
      // Layout only: keep every word, move the slide to the better layout.
      slide.layoutType = result.layoutType
    }
    await slide.save()
  }

  if (want.imagery)
    await enrichRefinedSlideImage(
      slide,
      result?.imageGuidance?.keywords,
      deck,
      descriptors,
    )

  /*
   * Splitting is applied here, not offered (GEN-4).
   *
   * It used to come back as a proposal the viewer put in a confirm dialog.
   * The permission now sits in the Refine form itself, as a checkbox the
   * instructor ticks before the run — so by the time a proposal exists they
   * have already said yes, and a second dialog would only ask them again. It
   * also puts splitting within reach of the whole-lecture pass, which runs in
   * the background and has nowhere to ask.
   *
   * Consent up front means the bar for proposing is higher, which is the
   * prompt's job (config/prompts/refine-split.txt): with no one to decline,
   * a close call has to come back as one slide.
   *
   * The split runs AFTER image enrichment so each part inherits a slide that
   * is already complete, and its own picture terms then replace the whole
   * slide's.
   */
  const proposal = maySplit ? result?.splitProposal : undefined
  const split = proposal
    ? await splitSlideIntoParts(deck, slide, proposal.parts, descriptors, {
        reason: proposal.reason,
      })
    : undefined

  return { changed: true, ...(split ? { split } : {}) }
}

/**
 * How strongly a lecture's spoken narration is refined: its own slider when
 * set, else the server default. There is no project-level refine setting, so
 * these are the only two tiers.
 */
const transcriptRefineLevel = (deck: DeckDoc): number =>
  deck.refineTranscriptLevel ?? env.REFINE_TRANSCRIPT_DEFAULT_LEVEL

/**
 * Generates one slide's refined narration WITHOUT writing it — the single place
 * the narration prompt is built, shared by the whole-lecture pass, the
 * single-slide refine, and the transcript editor's preview. Returns null when
 * the idempotency guard says nothing changed (unless `force`, i.e. a user asked
 * for this refine outright and expects a result).
 */
const refinedNarration = async (
  slide: SlideDoc,
  level: number,
  studentContext: boolean,
  deck: DeckDoc,
  gen: GenerationProvider,
  turns?: ReformatTurn[],
  force = false,
): Promise<{ transcript: string; hash?: string } | null> => {
  // Only a slide that actually mixes in student speech takes the turns path —
  // there is nothing to attribute on a lecturer-only slide, so it keeps the
  // legacy narration-refine behavior. The turns still include the lecturer's
  // spans, so they stay authoritative around the attributed student ones.
  const attributeTurns = turns?.some(t => t.role === 'student')
    ? turns
    : undefined
  // Turns path is idempotent: the narration is a pure function of the role
  // turns + level + language, so skip (and don't re-bill) when nothing changed
  // since the last run. The legacy path always re-narrates.
  const hash = attributeTurns
    ? narrateHash(attributeTurns, level, deck.language)
    : undefined
  if (
    !force &&
    hash &&
    slide.narrateInputHash === hash &&
    slide.sourceTranscript
  )
    return null
  const result = await gen.narrateSlide({
    slide: contentOf(slide),
    level,
    studentContext,
    language: deck.language,
    // With student turns, regenerate from the ordered turns (span-level
    // attribution woven at speaker switches) so nothing compounds; otherwise
    // refine the existing narration further, so repeated refines keep improving
    // it.
    ...(attributeTurns
      ? { turns: attributeTurns }
      : { transcript: slide.sourceTranscript }),
  })
  return { transcript: result.transcript, ...(hash ? { hash } : {}) }
}

/**
 * Re-narrates one slide so TTS playback stays in-line with its content; student
 * slides are framed as questions. Shared by the whole-lecture and single-slide
 * passes. Returns true once the narration is saved.
 */
const narrateOneSlide = async (
  slide: SlideDoc,
  level: number,
  studentContext: boolean,
  deck: DeckDoc,
  gen: GenerationProvider,
  turns?: ReformatTurn[],
): Promise<boolean> => {
  const narration = await refinedNarration(
    slide,
    level,
    studentContext,
    deck,
    gen,
    turns,
  )
  if (!narration) return false
  // Whiteboard stroke timing is anchored to the narration (WB-2); a wholesale
  // rewrite would strand it, so re-anchor each stroke's draw + erase anchors to
  // the conceptually-closest phrase of the new narration.
  const oldTranscript = slide.sourceTranscript ?? ''
  slide.sourceTranscript = narration.transcript
  await remapSlideDrawings(slide, oldTranscript, slide.sourceTranscript, gen)
  if (narration.hash) slide.narrateInputHash = narration.hash
  await slide.save()
  return true
}

/**
 * Re-anchors a slide's stroke marks when its transcript is rewritten (WB-2):
 * thin adapter over `remapDrawingAnchors` (semantic phrase re-match, orphan on
 * no-match, proportional fallback). A no-op when there are no drawings.
 */
const remapSlideDrawings = async (
  slide: SlideDoc,
  oldTranscript: string,
  newTranscript: string,
  gen: GenerationProvider,
): Promise<void> => {
  if (!slide.drawings?.length) return
  // toObject() yields plain strokes (safe to spread) rather than subdocuments.
  const plain = (slide.toObject().drawings ?? []) as Stroke[]
  const remapped = await remapDrawingAnchors(
    plain,
    oldTranscript,
    newTranscript,
    texts => gen.embedTexts(texts),
  )
  slide.set('drawings', remapped)
}

/**
 * A short name for a slide, for the progress line the instructor watches: its
 * title, else the opening of whatever text it carries. Trimmed to a length
 * that fits on one line rather than wrapping the status message.
 */
const PROGRESS_TITLE_CHARS = 60

const progressTitle = (slide: SlideDoc): string | undefined => {
  const source =
    slide.title?.trim() ||
    slide.body?.trim() ||
    slide.bullets?.find(b => b.trim())?.trim() ||
    ''
  if (!source) return undefined
  return source.length > PROGRESS_TITLE_CHARS
    ? `${source.slice(0, PROGRESS_TITLE_CHARS - 1).trimEnd()}…`
    : source
}

/**
 * The background body of a refine job. Runs the selected passes in order —
 * identify speakers → refine slide content → refine narration — then ALWAYS
 * re-narrates any slide whose content changed (and every slide when the
 * transcript pass is on), so TTS playback stays in-line with the final content
 * and student slides are narrated as questions. Per-slide LLM failures are
 * logged and skipped; a fatal error marks the job errored.
 *
 * As it goes it records which slide it is on, so the client polling
 * `deck.refineStatus` can name the slide being worked on instead of saying
 * only that something is happening. Progress is written before each slide,
 * so it always describes work in flight rather than work finished.
 */
const runRefine = async (
  jobId: string,
  deckId: string,
  input: DeckRefineInput,
): Promise<void> => {
  /** Records where the job is. Never allowed to fail the run: a lost
   * progress write costs a stale status line, not the refine. */
  const report = async (progress: RefineJobProgress): Promise<void> => {
    await RefineJobModel.updateOne({ _id: jobId }, { progress }).catch(() => {})
  }

  try {
    const deck = await DeckModel.findById(deckId)
    if (!deck) throw new Error('Deck no longer exists')
    const template = await resolveDeckTemplate(deck)
    const descriptors = template ? layoutDescriptors(template) : []
    const gen = registry.get<GenerationProvider>('generation')

    let reframed = 0
    let slidesRefined = 0
    let slidesSplit = 0
    let transcriptsUpdated = 0
    const changed = new Set<string>()

    // 1. Identify speakers: diarize, then reframe student/mixed slides.
    if (input.identifySpeakers) {
      // One long batch call over the whole recording, with no per-slide steps
      // to count — the phase is the whole of the progress it can report.
      await report({ phase: 'speakers', done: 0, total: 0 })
      await diarizeDeckRecordings(deck)
      const r = await reformatStudentSlides(deck, descriptors, gen)
      reframed = r.reframed
      for (const id of r.studentSlideIds) changed.add(id)
    }

    // 2. Refine slide content in place (protect hand-edited slides).
    if (input.refineSlides) {
      // Read once, before any splitting: the parts a split creates are
      // already the refined text, so re-refining them would rework what was
      // just written (and could split it again). Their `index` goes stale as
      // splits renumber the deck, which is why nothing below reads it — the
      // position shown in the progress line is counted from this pass's own
      // list, and every write is to a named path rather than the whole doc.
      const slides = await SlideModel.find({ deckId: deck._id }).sort({
        index: 1,
      })
      const total = slides.length
      for (const [i, slide] of slides.entries()) {
        await report({
          phase: 'slides',
          done: i,
          total,
          index: i + 1,
          title: progressTitle(slide),
        })
        try {
          const refined = await refineOneSlide(
            slide,
            input.refineSlides.level,
            deck,
            descriptors,
            gen,
            input.refineSlides.parts,
            input.refineSlides.allowSplit,
          )
          if (refined.changed) {
            changed.add(slide._id.toString())
            slidesRefined++
          }
          if (refined.split) {
            slidesSplit++
            // The parts are new slides with no narration of their own; mark
            // them changed so the pass below writes one, exactly as it does
            // for a slide whose content was rewritten.
            for (const part of refined.split.added)
              changed.add(part._id.toString())
          }
        } catch (error) {
          console.error('refineSlide failed for a slide:', error)
        }
      }
      await report({ phase: 'slides', done: total, total })
    }

    // 3 + TTS correctness: re-narrate every slide when the transcript pass is
    // on, otherwise just the slides whose content changed above.
    const allSlides = await SlideModel.find({ deckId: deck._id }).sort({
      index: 1,
    })
    const [studentIds, turnMap] = await Promise.all([
      studentSlideIds(deck._id),
      turnsBySlide(deck._id),
    ])
    const level = input.refineTranscript?.level ?? 1
    const targets = input.refineTranscript
      ? allSlides
      : allSlides.filter(s => changed.has(s._id.toString()))
    for (const [i, slide] of targets.entries()) {
      // Counted within this pass, like the slides pass above: "3 of 8" is the
      // eighth slide being narrated, which is not necessarily the eighth slide
      // in the lecture — only the changed ones are visited. The title says
      // which slide it actually is.
      await report({
        phase: 'narration',
        done: i,
        total: targets.length,
        index: i + 1,
        title: progressTitle(slide),
      })
      try {
        const sid = slide._id.toString()
        // Count only slides actually re-narrated — the idempotency guard skips
        // diarized slides whose turns/level/language are unchanged.
        if (
          await narrateOneSlide(
            slide,
            level,
            studentIds.has(sid),
            deck,
            gen,
            turnMap.get(sid),
          )
        )
          transcriptsUpdated++
      } catch (error) {
        console.error('narrateSlide failed for a slide:', error)
      }
    }

    if (reframed || slidesRefined || transcriptsUpdated)
      await touchDeck(deck._id)
    await RefineJobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'done',
          summary: { reframed, slidesRefined, slidesSplit, transcriptsUpdated },
        },
        // Nothing is in flight any more; the summary is what to show.
        $unset: { progress: 1 },
      },
    )
  } catch (error) {
    console.error('Refine job failed:', error)
    await RefineJobModel.updateOne(
      { _id: jobId },
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Refine failed',
      },
    ).catch(() => {})
  }
}

export const deckRefine = defineAction<
  DeckRefineInput,
  DeckRefineResult,
  DeckAccess
>({
  name: 'deck.refine',
  access: byDeckId,
  meter: requireAiTokens,
  input: z.object({
    deckId: z.string().min(1),
    identifySpeakers: z.boolean().optional(),
    refineSlides: z
      .object({
        level: z.number().int().min(1).max(5),
        parts: z
          .object({
            text: z.boolean().optional(),
            layout: z.boolean().optional(),
            imagery: z.boolean().optional(),
          })
          .optional(),
        allowSplit: z.boolean().optional(),
      })
      .optional(),
    refineTranscript: z
      .object({ level: z.number().int().min(1).max(5) })
      .optional(),
  }),
  execute: async (ctx, input, { deck }) => {
    const job = await RefineJobModel.create({
      deckId: deck._id,
      status: 'running',
    })
    // Fire-and-forget: the job runs in the background; the client polls status.
    void runRefine(job._id.toString(), deck._id.toString(), input)
    return { jobId: job._id.toString() }
  },
})

registerAction(deckRefine)

export const deckRefineStatus = defineAction<
  DeckRefineStatusInput,
  DeckRefineStatusResult,
  RefineJobAccess
>({
  name: 'deck.refineStatus',
  // The one action whose input names something other than what it
  // authorizes: the job is reached, then its lecture is what decides.
  access: refineJobEditor((input: { jobId: string }) => input.jobId),
  input: z.object({ jobId: z.string().min(1) }),
  execute: async (_ctx, _input, { job }) => ({
    status: job.status,
    summary: job.summary,
    // Where the run has got to, so the poller can name the slide in hand.
    // Cleared when the job finishes, so a done job never reports one.
    ...(job.progress ? { progress: job.progress } : {}),
    error: job.error,
  }),
})

registerAction(deckRefineStatus)

/** The recording sessions a slide's speech came from, for per-slide
 * diarization. Empty when the slide has no timed segments. */
const slideSessionIds = async (
  deck: DeckDoc,
  slide: SlideDoc,
): Promise<Set<string>> => {
  const segments = await TranscriptSegmentModel.find({
    deckId: deck._id,
    slideId: slide._id,
    startMs: { $ne: null },
  })
  return new Set(
    segments.map(s => s.sessionId).filter((id): id is string => Boolean(id)),
  )
}

/**
 * Identifies who spoke on ONE slide: diarizes the recording(s) its speech came
 * from, then reframes just that slide if students spoke on it. Roles come from
 * whole-recording talk-time (see diarizeDeckRecordings), so the lecturer is
 * still identified correctly even on a slide a student dominated. Returns
 * whether the slide was reframed; false when it has no retained audio.
 */
const identifySpeakersForSlide = async (
  deck: DeckDoc,
  slide: SlideDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
): Promise<boolean> => {
  const sessions = await slideSessionIds(deck, slide)
  if (!sessions.size) return false
  await diarizeDeckRecordings(deck, sessions)
  const { reframed } = await reformatStudentSlides(
    deck,
    descriptors,
    gen,
    slide._id.toString(),
  )
  return reframed > 0
}

/**
 * deck.refineSlide — the "Refine this slide with AI" kebab action, driven by
 * that dialog's options: identify speakers, the content pass narrowed to any of
 * text/layout/imagery, the narration pass, all at one chosen strength. Omitting
 * `options` falls back to the lecture's persisted Refine settings, which is how
 * the kebab behaved before the dialog existed.
 *
 * Runs synchronously (one slide is quick) and returns the refreshed slide.
 * Whenever the content changes, the narration is re-generated too, so TTS
 * playback stays in-line with the slide.
 */
export const deckRefineSlide = defineAction<
  DeckRefineSlideInput,
  DeckRefineSlideResult,
  DeckAccess
>({
  name: 'deck.refineSlide',
  access: byDeckId,
  meter: requireAiTokens,
  input: z.object({
    deckId: z.string().min(1),
    slideId: z.string().min(1),
    options: z
      .object({
        identifySpeakers: z.boolean().optional(),
        parts: z
          .object({
            text: z.boolean().optional(),
            layout: z.boolean().optional(),
            imagery: z.boolean().optional(),
          })
          .optional(),
        allowSplit: z.boolean().optional(),
        refineTranscript: z.boolean().optional(),
        level: z.number().int().min(1).max(5).optional(),
      })
      .optional(),
  }),
  execute: async (ctx, input, { deck }) => {
    let slide = await SlideModel.findOne({
      _id: input.slideId,
      deckId: deck._id,
    })
    if (!slide) throw new ActionForbiddenError()

    const template = await resolveDeckTemplate(deck)
    const descriptors = template ? layoutDescriptors(template) : []
    const gen = registry.get<GenerationProvider>('generation')

    // This run's choices, each falling back to the lecture's saved setting.
    const options = input.options
    const parts = options?.parts
    const contentEnabled = options
      ? Object.values(resolveParts(parts)).some(Boolean)
      : (deck.refineSlidesEnabled ?? true)
    const transcriptEnabled =
      options?.refineTranscript ?? deck.refineTranscriptEnabled ?? true
    // Off unless asked for, by this run or by the lecture's saved setting:
    // splitting changes how many slides the lecture has, so it is never
    // something a refine does because nobody said otherwise.
    const allowSplit = options?.allowSplit ?? deck.refineSplitEnabled ?? false
    // One slider drives both passes when the dialog sets it.
    const slidesLevel =
      options?.level ??
      deck.refineSlidesLevel ??
      env.REFINE_SLIDES_DEFAULT_LEVEL
    const transcriptLevel = options?.level ?? transcriptRefineLevel(deck)

    // Speakers first: reframing rewrites the slide's content, so the content
    // and narration passes below should act on the reframed version.
    let reframed: boolean | undefined
    if (options?.identifySpeakers) {
      reframed = await identifySpeakersForSlide(deck, slide, descriptors, gen)
      // Reformatting saved through its own document; re-read before refining.
      slide = (await SlideModel.findById(slide._id)) ?? slide
    }

    const outcome: RefineOutcome = contentEnabled
      ? await refineOneSlide(
          slide,
          slidesLevel,
          deck,
          descriptors,
          gen,
          parts,
          allowSplit,
        )
      : { changed: false }
    const refined = outcome.changed
    // A split re-read the slide as it was written; narrate that version, not
    // the pre-split doc whose body the first part has replaced.
    if (outcome.split) slide = outcome.split.first

    // Re-narrate when the transcript pass is on, or whenever the content
    // changed, so TTS playback stays in-line with the slide.
    let narrationUpdated = false
    if (transcriptEnabled || refined || reframed) {
      const [studentIds, turnMap] = await Promise.all([
        studentSlideIds(deck._id),
        turnsBySlide(deck._id),
      ])
      const sid = slide._id.toString()
      narrationUpdated = await narrateOneSlide(
        slide,
        transcriptEnabled ? transcriptLevel : 1,
        studentIds.has(sid),
        deck,
        gen,
        turnMap.get(sid),
      )
    }

    if (refined || narrationUpdated || reframed) await touchDeck(deck._id)
    // Re-read so the DTO reflects any image enrichment saved during the pass.
    const fresh = (await SlideModel.findById(slide._id)) ?? slide
    return {
      slide: toSlideDto(fresh),
      refined,
      narrationUpdated,
      ...(reframed === undefined ? {} : { reframed }),
      // Already written. The viewer splices the new slides in rather than
      // asking whether to make them — the instructor allowed this before the
      // run started.
      ...(outcome.split
        ? {
            split: {
              reason: outcome.split.reason,
              added: outcome.split.added.map(toSlideDto),
              slideOrder: outcome.split.slideOrder,
            },
          }
        : {}),
    }
  },
})

registerAction(deckRefineSlide)

/**
 * deck.splitSlide — writes a split from parts the caller supplies (GEN-4).
 *
 * A refine now writes its own splits, with the instructor's permission taken
 * up front (the "break a slide up" checkbox), so this is no longer how the
 * viewer applies one. It remains the direct way to divide a slide into
 * content the caller already has — parts chosen by hand, or by a script.
 *
 * The parts come in rather than being looked up, so what is written is exactly
 * what was decided on — the same contract as the quiz review (QUIZ-2) — and
 * they are validated against the deck's own template regardless. The write
 * itself is `splitSlideIntoParts`, shared with the refine.
 */
export const deckSplitSlide = defineAction<
  DeckSplitSlideInput,
  DeckSplitSlideResult,
  DeckAccess
>({
  name: 'deck.splitSlide',
  access: byDeckId,
  input: z.object({
    deckId: z.string().min(1),
    slideId: z.string().min(1),
    parts: z
      .array(
        z.object({
          layoutType: z.string().min(1),
          slots: z.object({
            title: z.string().optional(),
            body: z.string().optional(),
            bullets: z.array(z.string()).optional(),
            caption: z.string().optional(),
          }),
          imageGuidance: z
            .object({
              keywords: z.array(z.string()),
              none: z.boolean().optional(),
            })
            .optional(),
        }),
      )
      // Fewer than two is not a split, and the cap is what the instructor was
      // asked to read.
      .min(2)
      .max(MAX_SPLIT_PARTS),
  }),
  execute: async (ctx, input, { deck }) => {
    const slide = await SlideModel.findOne({
      _id: input.slideId,
      deckId: deck._id,
    })
    if (!slide) throw new ActionForbiddenError()

    const template = await resolveDeckTemplate(deck)
    const descriptors = template ? layoutDescriptors(template) : []
    const split = await splitSlideIntoParts(
      deck,
      slide,
      input.parts,
      descriptors,
    )
    return {
      slide: toSlideDto(split.first),
      added: split.added.map(toSlideDto),
      slideOrder: split.slideOrder,
    }
  },
})

registerAction(deckSplitSlide)

/**
 * deck.refineSlideTranscript — refines ONE slide's spoken narration and hands
 * the text back, the transcript editor's "Refine" button (EDIT-6). It runs the
 * same narration pass as the kebab "Refine this slide" and the lecture-wide
 * Refine tab, at the same strength (the lecture's transcript slider, else the
 * server default), so all three produce the same kind of rewrite.
 *
 * By default nothing is written: the user reviews the result in the editor and
 * saves it themselves. `save: true` applies it (re-anchoring whiteboard marks),
 * which is what a refine-every-transcript pass would want. Unlike the
 * background pass this never skips on the idempotency guard — the user asked
 * for a rewrite and must get one.
 */
export const deckRefineSlideTranscript = defineAction<
  DeckRefineSlideTranscriptInput,
  DeckRefineSlideTranscriptResult,
  DeckAccess
>({
  name: 'deck.refineSlideTranscript',
  access: byDeckId,
  // Rewrites narration with the generation model; it does not re-transcribe.
  meter: requireAiTokens,
  input: z.object({
    deckId: z.string().min(1),
    slideId: z.string().min(1),
    save: z.boolean().optional(),
  }),
  execute: async (ctx, input, { deck }) => {
    const slide = await SlideModel.findOne({
      _id: input.slideId,
      deckId: deck._id,
    })
    if (!slide) throw new ActionForbiddenError()

    const gen = registry.get<GenerationProvider>('generation')
    const [studentIds, turnMap] = await Promise.all([
      studentSlideIds(deck._id),
      turnsBySlide(deck._id),
    ])
    const sid = slide._id.toString()
    const narration = await refinedNarration(
      slide,
      transcriptRefineLevel(deck),
      studentIds.has(sid),
      deck,
      gen,
      turnMap.get(sid),
      true,
    )
    const transcript = narration?.transcript ?? slide.sourceTranscript ?? ''
    const saved = input.save
      ? await applySlideTranscript(slide, transcript)
      : false
    return { transcript, ...(saved ? { slide: toSlideDto(slide) } : {}) }
  },
})

registerAction(deckRefineSlideTranscript)
