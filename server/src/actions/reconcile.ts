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
  DiarizationProvider,
  DiarizedSpeakerSegment,
  GenerationProvider,
  LayoutDescriptor,
  LayoutType,
  ReformatTurn,
  SlideContent,
  SlideRefineParts,
  SpeakerRole,
  Stroke,
} from '@slide-machine/shared'
import { remapDrawingAnchors } from './remap-drawings'
import { applySlideTranscript } from '../lib/slide-transcript'
import { defineAction } from './define'
import { requireAiTokens, assertUserCapacity } from '../billing/meter-hooks'
import { currentUsageUser, meterUsage } from '../billing/usage-context'
import { registerAction, ActionForbiddenError } from './dispatch'
import { loadEditableDeck } from './deck'
import { env } from '../config/env'
import { registry } from '../providers/registry'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { SlideModel, toSlideDto, type SlideDb } from '../models/slide'
import { DeckModel, loadDeckAcl, touchDeck, type DeckDb } from '../models/deck'
import { canEditAcl } from '../lib/access'
import { RefineJobModel } from '../models/refine-job'
import { getBuiltinTemplate, layoutDescriptors } from '../templates/builtin'
import { assignSpeakers } from '../lib/diarization-join'
import { mapSpeakerRoles } from '../lib/speaker-roles'
import { planReformat } from '../lib/reformat-plan'
import { layoutHasImageSlot } from '../lib/image-layout'
import { layoutDisplaysContent } from '../lib/layout-refit'
import { enrichSlideImage } from '../enrichment/enrich'
import type { SlideImageContext } from '../enrichment/types'
import { deriveImageKeywords } from '../enrichment/keywords'
import { seedAssetsFor, seededImageCandidates } from '../lib/seed-assets'

type DeckDoc = HydratedDocument<DeckDb>
type SlideDoc = HydratedDocument<SlideDb>

/** The slide's editable content, as the generation passes consume it. */
const contentOf = (s: SlideDoc): SlideContent => ({
  layoutType: s.layoutType,
  title: s.title,
  body: s.body,
  bullets: s.bullets,
  caption: s.caption,
})

/** Writes a generation result's content back onto a slide (image + id kept). */
const applyContent = (
  s: SlideDoc,
  result: {
    layoutType: LayoutType
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
    await enrichSlideImage(
      slide._id.toString(),
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

export const deckDiarize = defineAction<DeckDiarizeInput, DeckDiarizeResult>({
  name: 'deck.diarize',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    return diarizeDeckRecordings(deck)
  },
})

registerAction(deckDiarize)

export const deckReformat = defineAction<DeckReformatInput, DeckReformatResult>(
  {
    name: 'deck.reformat',
    meter: requireAiTokens,
    input: z.object({ deckId: z.string().min(1) }),
    execute: async (ctx, input) => {
      const { deck } = await loadEditableDeck(ctx, input.deckId)
      const template = getBuiltinTemplate(deck.templateId)
      const descriptors = template ? layoutDescriptors(template) : []
      const gen = registry.get<GenerationProvider>('generation')
      const { reframed, kept, protectedCount } = await reformatStudentSlides(
        deck,
        descriptors,
        gen,
      )
      return { reformatted: reframed, kept, protectedCount }
    },
  },
)

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
const refineOneSlide = async (
  slide: SlideDoc,
  level: number,
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
  parts?: SlideRefineParts,
): Promise<boolean> => {
  if (slide.manuallyEdited) return false
  const want = resolveParts(parts)
  if (!want.text && !want.layout && !want.imagery) return false

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
  return true
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
 * The background body of a refine job. Runs the selected passes in order —
 * identify speakers → refine slide content → refine narration — then ALWAYS
 * re-narrates any slide whose content changed (and every slide when the
 * transcript pass is on), so TTS playback stays in-line with the final content
 * and student slides are narrated as questions. Per-slide LLM failures are
 * logged and skipped; a fatal error marks the job errored.
 */
const runRefine = async (
  jobId: string,
  deckId: string,
  input: DeckRefineInput,
): Promise<void> => {
  try {
    const deck = await DeckModel.findById(deckId)
    if (!deck) throw new Error('Deck no longer exists')
    const template = getBuiltinTemplate(deck.templateId)
    const descriptors = template ? layoutDescriptors(template) : []
    const gen = registry.get<GenerationProvider>('generation')

    let reframed = 0
    let slidesRefined = 0
    let transcriptsUpdated = 0
    const changed = new Set<string>()

    // 1. Identify speakers: diarize, then reframe student/mixed slides.
    if (input.identifySpeakers) {
      await diarizeDeckRecordings(deck)
      const r = await reformatStudentSlides(deck, descriptors, gen)
      reframed = r.reframed
      for (const id of r.studentSlideIds) changed.add(id)
    }

    // 2. Refine slide content in place (protect hand-edited slides).
    if (input.refineSlides) {
      const slides = await SlideModel.find({ deckId: deck._id }).sort({
        index: 1,
      })
      for (const slide of slides) {
        try {
          const refined = await refineOneSlide(
            slide,
            input.refineSlides.level,
            deck,
            descriptors,
            gen,
            // The lecture-wide UI has no text/layout/imagery split yet, so this
            // is normally absent (= refine everything); the pass is ready for
            // one the day it grows the checkboxes.
            input.refineSlides.parts,
          )
          if (refined) {
            changed.add(slide._id.toString())
            slidesRefined++
          }
        } catch (error) {
          console.error('refineSlide failed for a slide:', error)
        }
      }
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
    for (const slide of targets) {
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
        status: 'done',
        summary: { reframed, slidesRefined, transcriptsUpdated },
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

export const deckRefine = defineAction<DeckRefineInput, DeckRefineResult>({
  name: 'deck.refine',
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
      })
      .optional(),
    refineTranscript: z
      .object({ level: z.number().int().min(1).max(5) })
      .optional(),
  }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
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
  DeckRefineStatusResult
>({
  name: 'deck.refineStatus',
  input: z.object({ jobId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const job = await RefineJobModel.findById(input.jobId).catch(() => null)
    if (!job) throw new ActionForbiddenError()
    // Gate on edit access to the job's deck.
    const deck = await DeckModel.findById(job.deckId).catch(() => null)
    if (!deck) throw new ActionForbiddenError()
    if (!canEditAcl(await loadDeckAcl(deck), ctx.userId))
      throw new ActionForbiddenError()
    return { status: job.status, summary: job.summary, error: job.error }
  },
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
  DeckRefineSlideResult
>({
  name: 'deck.refineSlide',
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
        refineTranscript: z.boolean().optional(),
        level: z.number().int().min(1).max(5).optional(),
      })
      .optional(),
  }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    let slide = await SlideModel.findOne({
      _id: input.slideId,
      deckId: deck._id,
    })
    if (!slide) throw new ActionForbiddenError()

    const template = getBuiltinTemplate(deck.templateId)
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

    const refined = contentEnabled
      ? await refineOneSlide(slide, slidesLevel, deck, descriptors, gen, parts)
      : false

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
    }
  },
})

registerAction(deckRefineSlide)

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
  DeckRefineSlideTranscriptResult
>({
  name: 'deck.refineSlideTranscript',
  // Rewrites narration with the generation model; it does not re-transcribe.
  meter: requireAiTokens,
  input: z.object({
    deckId: z.string().min(1),
    slideId: z.string().min(1),
    save: z.boolean().optional(),
  }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
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
