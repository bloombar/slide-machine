/**
 * Integration test for the single-slide "Refine this slide" action
 * (deck.refineSlide, GEN-4): it refines one slide using the lecture's persisted
 * Refine settings (which passes are on + their levels), leaves every other
 * slide untouched, keeps TTS narration in-line, protects hand-edited slides,
 * and gates on edit access. Also covers deck.refineSlideTranscript, the
 * transcript editor's narration-only refine, which shares that pass and level.
 * MongoDB real; mock providers.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import request from 'supertest'
import type { GenerationProvider } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { registry } from '../../src/providers/registry'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(disconnectMongo)

/** Two slides; returns their ids. The first is the refine target. */
const seedSlides = async (): Promise<{ target: string; other: string }> => {
  const target = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    title: 'Photosynthesis',
    body: 'Plants convert light to energy',
  })
  const other = await SlideModel.create({
    deckId,
    index: 1,
    layoutType: 'content',
    title: 'Respiration',
    body: 'Cells release energy',
  })
  return { target: target._id.toString(), other: other._id.toString() }
}

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('deck.refineSlide', () => {
  it('refines only the target slide, at the default levels, and re-narrates it', async () => {
    const { target, other } = await seedSlides()

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.status).toBe(200)
    expect(res.body.refined).toBe(true)
    expect(res.body.narrationUpdated).toBe(true)
    // The DTO is the freshly-refined slide.
    expect(res.body.slide.id).toBe(target)
    expect(res.body.slide.caption).toBe(
      `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
    )

    // Target: content refined (caption) + narration in-line with its content.
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBe(
      `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
    )
    expect(t?.sourceTranscript).toContain('Photosynthesis')

    // The other slide is untouched.
    const o = await SlideModel.findById(other)
    expect(o?.caption).toBeUndefined()
    expect(o?.sourceTranscript).toBeUndefined()
  })

  it("uses the lecture's saved slider level", async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', { deckId, slidesLevel: 5 })

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBe('Refined (level 5)')
  })

  it('skips the content pass when slides are disabled but still narrates', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      transcriptEnabled: true,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(false)
    expect(res.body.narrationUpdated).toBe(true)
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined() // content untouched
    expect(t?.sourceTranscript).toContain('Photosynthesis') // narration updated
  })

  it('re-narrates even when transcript is disabled, because the content changed', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: true,
      transcriptEnabled: false,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(true)
    // TTS must stay in-line, so a content change forces a re-narration.
    expect(res.body.narrationUpdated).toBe(true)
  })

  it('does nothing when both slide-applicable passes are off', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      transcriptEnabled: false,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body).toMatchObject({ refined: false, narrationUpdated: false })
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined()
    expect(t?.sourceTranscript).toBeUndefined()
  })

  it('protects a hand-edited slide from the content pass', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne({ _id: target }, { manuallyEdited: true })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(false)
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined()
    // Narration still refreshes (transcript pass defaults on).
    expect(res.body.narrationUpdated).toBe(true)
  })

  it('frames the narration as a question for a student slide', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toMatch(/^A student asked:/)
  })

  it('refines the existing narration further on each pass (incremental)', async () => {
    const { target } = await seedSlides()
    // Give the slide an original spoken transcript, as a live session would.
    await SlideModel.updateOne(
      { _id: target },
      { sourceTranscript: 'The original spoken words.' },
    )

    // First refine builds on the original transcript.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const after1 = await SlideModel.findById(target)
    expect(after1?.sourceTranscript).toContain('The original spoken words.')
    expect(after1?.sourceTranscript).toContain('(refined)')

    // Second refine builds on the first refinement — it compounds, and never
    // reverts to narrating from the slide's title/body.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const after2 = await SlideModel.findById(target)
    expect(after2?.sourceTranscript).toContain('The original spoken words.')
    expect(after2?.sourceTranscript).toMatch(/\(refined\).*\(refined\)/s)
    expect(after2?.sourceTranscript).not.toContain('Photosynthesis')
  })

  it('rescales whiteboard stroke anchors when the narration is rewritten (WB-2)', async () => {
    const { target } = await seedSlides()
    // A 20-char transcript with a stroke drawn at the halfway point and later
    // erased at the end. The mock narrator appends " (refined)" → 30 chars.
    await SlideModel.updateOne(
      { _id: target },
      {
        sourceTranscript: 'Photosynthesis rocks', // 20 chars
        drawings: [
          {
            id: 'd1',
            tool: 'pen',
            color: '#1e293b',
            thickness: 0.01,
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.2 },
            ],
            startedAt: '2026-07-21T10:00:00.000Z',
            endedAt: '2026-07-21T10:00:01.000Z',
            anchor: { charAnchor: 10, source: 'appended' },
            erasedAnchor: { charAnchor: 20, source: 'word' },
            erasedAt: '2026-07-21T10:00:05.000Z',
          },
        ],
      },
    )

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })

    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('Photosynthesis rocks (refined)') // 30 chars
    // Anchors stay proportional: 10/20 → 15/30, 20/20 → 30/30.
    expect(t?.drawings?.[0]?.anchor.charAnchor).toBe(15)
    expect(t?.drawings?.[0]?.erasedAnchor?.charAnchor).toBe(30)
  })

  // The per-slide dialog sends what THIS run should do; the lecture's saved
  // settings only apply when it sends nothing.
  describe('with per-run options', () => {
    it('refines only the parts asked for', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')

      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { parts: { text: true, layout: false, imagery: false } },
      })

      // Text without layout: the model is offered only the slide's current
      // layout, so it writes into the slots that slide actually has.
      const offered = refine.mock.calls[0]![0].layoutDescriptors
      expect(offered.map(d => d.type)).toEqual(['content'])
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBe(
        `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
      )
      expect(t?.layoutType).toBe('content')
      refine.mockRestore()
    })

    it('never calls the model when only imagery is asked for', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { parts: { text: false, layout: false, imagery: true } },
      })

      expect(res.status).toBe(200)
      // Enrichment falls back to the slide's own keywords, so nothing is
      // billed for text that would be discarded.
      expect(refine).not.toHaveBeenCalled()
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBeUndefined() // words untouched
      refine.mockRestore()
    })

    it('applies one slider to both the content and narration passes', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')
      const narrate = vi.spyOn(gen, 'narrateSlide')

      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { refineTranscript: true, level: 5 },
      })

      expect(refine).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 5 }),
      )
      expect(narrate).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 5 }),
      )
      refine.mockRestore()
      narrate.mockRestore()
    })

    it('skips the content pass when no part is selected', async () => {
      const { target } = await seedSlides()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: {
          parts: { text: false, layout: false, imagery: false },
          refineTranscript: true,
        },
      })

      expect(res.body.refined).toBe(false)
      expect(res.body.narrationUpdated).toBe(true)
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBeUndefined()
    })

    it('identifies speakers from this slide’s own recording and reframes it', async () => {
      const { target, other } = await seedSlides()
      // A recording plus a student turn on the target slide only.
      await DeckModel.updateOne(
        { _id: deckId },
        {
          $push: {
            recordings: {
              sessionId: 'rec-1',
              audioKey: `audio/${deckId}/rec-1.wav`,
              sampleRate: 16_000,
              durationMs: 620_000,
              createdAt: new Date(),
            },
          },
        },
      )
      // The mock diarizer puts speaker 2 (a student) in the 600–620s window.
      await TranscriptSegmentModel.create({
        deckId,
        sessionId: 'rec-1',
        text: 'Is this on the exam?',
        action: 'none',
        slideId: target,
        startMs: 605_000,
        endMs: 610_000,
        words: [{ word: 'Is', startMs: 605_000, endMs: 610_000 }],
      })

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: {
          identifySpeakers: true,
          parts: { text: false, layout: false, imagery: false },
        },
      })

      expect(res.status).toBe(200)
      expect(res.body.reframed).toBe(true)
      // The slide's segment is now tagged, and its narration attributes the
      // student rather than stating it as fact.
      const seg = await TranscriptSegmentModel.findOne({ slideId: target })
      expect(seg?.role).toBe('student')
      const t = await SlideModel.findById(target)
      expect(t?.sourceTranscript).toMatch(/^A student asked:/)
      // Only this slide was touched.
      const o = await SlideModel.findById(other)
      expect(o?.sourceTranscript).toBeUndefined()
    })

    it('reports no reframing when the slide has no retained audio', async () => {
      const { target } = await seedSlides()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { identifySpeakers: true },
      })
      expect(res.status).toBe(200)
      expect(res.body.reframed).toBe(false)
    })
  })

  it('gates on edit access and slide ownership', async () => {
    const { target } = await seedSlides()
    const bob = await registerUser('bob@example.com')
    expect(
      (await act(bob, 'deck.refineSlide', { deckId, slideId: target })).status,
    ).toBe(403)

    // A slide that belongs to a different deck is rejected.
    const other = await act(ada, 'deck.create', {
      projectId: (await act(ada, 'project.create', { title: 'Other' })).body.id,
      title: 'Other lecture',
      templateId: 'classic',
    })
    const stray = await SlideModel.create({
      deckId: other.body.id,
      index: 0,
      layoutType: 'content',
      title: 'Stray',
    })
    expect(
      (
        await act(ada, 'deck.refineSlide', {
          deckId,
          slideId: stray._id.toString(),
        })
      ).status,
    ).toBe(403)
  })
})

/**
 * The transcript editor's "Refine" button runs the same narration pass, at the
 * same strength, but hands the text back instead of writing it.
 */
describe('deck.refineSlideTranscript', () => {
  it('returns the refined narration without touching the slide', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne(
      { _id: target },
      { sourceTranscript: 'The original spoken words.' },
    )

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(200)
    expect(res.body.transcript).toBe('The original spoken words. (refined)')
    // Nothing is saved until the user accepts it in the editor.
    expect(res.body.slide).toBeUndefined()
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('The original spoken words.')
    // And the content pass never runs — this refines the narration only.
    expect(t?.caption).toBeUndefined()
  })

  it('writes it, and re-anchors whiteboard marks, when asked to save', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne(
      { _id: target },
      {
        sourceTranscript: 'Photosynthesis rocks', // 20 chars → 30 refined
        drawings: [
          {
            id: 'stroke-1',
            tool: 'pen',
            color: '#1e293b',
            thickness: 0.01,
            points: [{ x: 0.2, y: 0.3 }],
            startedAt: '2026-07-21T10:00:00.000Z',
            endedAt: '2026-07-21T10:00:01.000Z',
            anchor: { charAnchor: 10, source: 'word' },
          },
        ],
      },
    )

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
      save: true,
    })
    expect(res.body.slide.sourceTranscript).toBe(
      'Photosynthesis rocks (refined)',
    )
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('Photosynthesis rocks (refined)')
    // Proportional re-anchor, as on every other transcript rewrite: 10/20 → 15/30.
    expect(t?.drawings?.[0]?.anchor.charAnchor).toBe(15)
  })

  // The strength comes from the lecture's transcript slider, else the server
  // default — there is no project tier for refine settings.
  it("refines at the lecture's saved transcript level, else the default", async () => {
    const { target } = await seedSlides()
    const gen = registry.get<GenerationProvider>('generation')
    const narrate = vi.spyOn(gen, 'narrateSlide')

    await act(ada, 'deck.refineSlideTranscript', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: env.REFINE_TRANSCRIPT_DEFAULT_LEVEL }),
    )

    await act(ada, 'deck.setRefineSettings', { deckId, transcriptLevel: 4 })
    await act(ada, 'deck.refineSlideTranscript', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 4 }),
    )

    // The same level the kebab "Refine this slide" narrates at.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 4 }),
    )
    narrate.mockRestore()
  })

  it('frames the narration as a question for a student slide', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.body.transcript).toMatch(/^A student asked:/)
  })

  it('always produces a rewrite, even when the background pass would skip', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })
    // A full refine records the idempotency hash, which makes the background
    // pass skip this slide next time.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const second = await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target,
    })
    expect(second.body.narrationUpdated).toBe(false)

    // The user clicked Refine, so they get text back regardless.
    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(200)
    expect(res.body.transcript).toMatch(/^A student asked:/)
  })

  it('gates on edit access', async () => {
    const { target } = await seedSlides()
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(403)
  })
})
