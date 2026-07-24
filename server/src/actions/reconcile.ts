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
  DeckRefineStatusInput,
  DeckRefineStatusResult,
  DiarizationProvider,
  GenerationProvider,
  LayoutDescriptor,
  LayoutType,
  ReformatTurn,
  SlideContent,
  SpeakerRole,
  Stroke,
} from '@slide-machine/shared'
import { remapDrawingAnchors } from './remap-drawings'
import { defineAction } from './define'
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

/** Diarizes each retained recording and tags its segments with speaker + role. */
const diarizeDeckRecordings = async (
  deck: DeckDoc,
): Promise<DeckDiarizeResult> => {
  const recordings = deck.recordings ?? []
  if (!recordings.length) return { sessionsProcessed: 0, segmentsTagged: 0 }

  const provider = registry.get<DiarizationProvider>('diarization')
  const segments = await TranscriptSegmentModel.find({ deckId: deck._id })

  let sessionsProcessed = 0
  let segmentsTagged = 0
  for (const rec of recordings) {
    const sessionSegments = segments.filter(s => s.sessionId === rec.sessionId)
    if (!sessionSegments.length) continue

    const diarized = await provider.diarize({
      audioKey: rec.audioKey,
      sampleRate: rec.sampleRate,
    })
    if (!diarized.length) continue
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
 * represent student speech (so their narration is framed accordingly). */
const reformatStudentSlides = async (
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
): Promise<{
  reframed: number
  kept: number
  protectedCount: number
  studentSlideIds: Set<string>
}> => {
  const [slides, turnMap] = await Promise.all([
    SlideModel.find({ deckId: deck._id }).sort({ index: 1 }),
    turnsBySlide(deck._id),
  ])

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

/**
 * Refines one slide's content in place — the shared body of both the
 * whole-lecture refine loop and the single-slide "Refine this slide" action.
 * Hand-edited slides are protected (returns false, untouched). On success it
 * applies the new content, saves, and sources an image if the refined layout
 * opened an empty image slot.
 */
const refineOneSlide = async (
  slide: SlideDoc,
  level: number,
  deck: DeckDoc,
  descriptors: LayoutDescriptor[],
  gen: GenerationProvider,
): Promise<boolean> => {
  if (slide.manuallyEdited) return false
  const result = await gen.refineSlide({
    current: contentOf(slide),
    level,
    layoutDescriptors: descriptors,
    language: deck.language,
    seedContext: { deck: deck.seedContext },
    // The slide's current transcript as source material (original spoken words
    // on the first refine, previously-refined narration on later ones).
    transcript: slide.sourceTranscript,
  })
  applyContent(slide, result)
  await slide.save()
  await enrichRefinedSlideImage(
    slide,
    result.imageGuidance?.keywords,
    deck,
    descriptors,
  )
  return true
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
  if (hash && slide.narrateInputHash === hash && slide.sourceTranscript)
    return false
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
  // Whiteboard stroke timing is anchored to the narration (WB-2); a wholesale
  // rewrite would strand it, so re-anchor each stroke's draw + erase anchors to
  // the conceptually-closest phrase of the new narration.
  const oldTranscript = slide.sourceTranscript ?? ''
  slide.sourceTranscript = result.transcript
  await remapSlideDrawings(slide, oldTranscript, slide.sourceTranscript, gen)
  if (hash) slide.narrateInputHash = hash
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
  input: z.object({
    deckId: z.string().min(1),
    identifySpeakers: z.boolean().optional(),
    refineSlides: z
      .object({ level: z.number().int().min(1).max(5) })
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

/**
 * deck.refineSlide — the "Refine this slide" kebab action. Refines a single
 * slide using the lecture's persisted Refine settings: the content pass (at the
 * lecture's slides level) and/or the narration pass (at its transcript level).
 * Diarization is deck-wide, so the "identify speakers" pass never applies here.
 * Runs synchronously (one slide is quick) and returns the refreshed slide.
 * Whenever the content changes, the narration is re-generated too, so TTS
 * playback stays in-line with the slide.
 */
export const deckRefineSlide = defineAction<
  DeckRefineSlideInput,
  DeckRefineSlideResult
>({
  name: 'deck.refineSlide',
  input: z.object({
    deckId: z.string().min(1),
    slideId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    const slide = await SlideModel.findOne({
      _id: input.slideId,
      deckId: deck._id,
    })
    if (!slide) throw new ActionForbiddenError()

    const template = getBuiltinTemplate(deck.templateId)
    const descriptors = template ? layoutDescriptors(template) : []
    const gen = registry.get<GenerationProvider>('generation')

    // The lecture's persisted settings, each falling back to its default.
    const slidesEnabled = deck.refineSlidesEnabled ?? true
    const transcriptEnabled = deck.refineTranscriptEnabled ?? true
    const slidesLevel =
      deck.refineSlidesLevel ?? env.REFINE_SLIDES_DEFAULT_LEVEL
    const transcriptLevel =
      deck.refineTranscriptLevel ?? env.REFINE_TRANSCRIPT_DEFAULT_LEVEL

    const refined = slidesEnabled
      ? await refineOneSlide(slide, slidesLevel, deck, descriptors, gen)
      : false

    // Re-narrate when the transcript pass is on, or whenever the content
    // changed, so TTS playback stays in-line with the slide.
    let narrationUpdated = false
    if (transcriptEnabled || refined) {
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

    if (refined || narrationUpdated) await touchDeck(deck._id)
    // Re-read so the DTO reflects any image enrichment saved during the pass.
    const fresh = (await SlideModel.findById(slide._id)) ?? slide
    return { slide: toSlideDto(fresh), refined, narrationUpdated }
  },
})

registerAction(deckRefineSlide)
