/**
 * Integration test for the Refine background job (GEN-4): deck.refine runs the
 * selected passes — identify speakers, refine slide content, refine narration —
 * and deck.refineStatus reports completion. Verifies student slides are
 * reframed, content is refined, and the spoken narration is updated in-line
 * (student slides framed as questions). MongoDB real; mock providers.
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
import { RefineJobModel } from '../../src/models/refine-job'
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

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefineJobModel.deleteMany({}),
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

/** Polls deck.refineStatus until the job leaves 'running'. */
const awaitJob = (jobId: string) =>
  vi.waitFor(
    async () => {
      const res = await act(ada, 'deck.refineStatus', { jobId })
      expect(res.body.status).not.toBe('running')
      return res.body
    },
    { timeout: 5000, interval: 50 },
  )

describe('deck.refine', () => {
  it('runs all three passes as a job and keeps narration in-line', async () => {
    // One recording; the mock diarizer scripts speaker 1 (lecturer, 0–600s) and
    // speaker 2 (student, 600–620s).
    await DeckModel.updateOne(
      { _id: deckId },
      {
        $push: {
          recordings: {
            sessionId: 'rec-1',
            audioKey: 'audio/x.wav',
            sampleRate: 16_000,
            durationMs: 620_000,
            createdAt: new Date(),
          },
        },
      },
    )
    const lecturer = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Photosynthesis',
      body: 'Plants convert light to energy',
    })
    const student = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'list',
      title: 'Membrane',
      bullets: ['Membrane facts'],
    })
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Plants convert light to energy',
      action: 'new',
      slideId: lecturer._id,
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Plants', startMs: 0, endMs: 1000 }],
    })
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: student._id,
      startMs: 600_500,
      endMs: 601_000,
      words: [{ word: 'Is', startMs: 600_500, endMs: 601_000 }],
    })

    const start = await act(ada, 'deck.refine', {
      deckId,
      identifySpeakers: true,
      refineSlides: { level: 3 },
      refineTranscript: { level: 2 },
    })
    expect(start.status).toBe(200)
    const jobId = start.body.jobId as string

    const done = await awaitJob(jobId)
    expect(done.status).toBe('done')
    expect(done.summary).toEqual({
      reframed: 1,
      slidesRefined: 2,
      slidesSplit: 0,
      transcriptsUpdated: 2,
    })

    // Student slide: reframed (Q: bullet), refined (caption), narrated as a question.
    const s = await SlideModel.findById(student._id)
    expect(s?.bullets).toContain('Q: Is this on the exam?')
    expect(s?.caption).toBe('Refined (level 3)')
    expect(s?.sourceTranscript).toMatch(/^A student asked:/)

    // Lecturer slide: refined, narrated plainly (not as a student question).
    const l = await SlideModel.findById(lecturer._id)
    expect(l?.caption).toBe('Refined (level 3)')
    expect(l?.sourceTranscript).not.toMatch(/^A student asked:/)
    expect(l?.sourceTranscript).toContain('Photosynthesis')
  })

  it('attributes a student turn within a mixed slide, idempotently', async () => {
    // Same recording script: speaker 1 lecturer (0–600s), speaker 2 student
    // (600–620s).
    await DeckModel.updateOne(
      { _id: deckId },
      {
        $push: {
          recordings: {
            sessionId: 'rec-1',
            audioKey: 'audio/x.wav',
            sampleRate: 16_000,
            durationMs: 620_000,
            createdAt: new Date(),
          },
        },
      },
    )
    // One slide that MIXES a lecturer turn and a later student turn.
    const mixed = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Osmosis',
      body: 'Water crosses membranes',
    })
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Water crosses membranes',
      action: 'new',
      slideId: mixed._id,
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Water', startMs: 0, endMs: 1000 }],
    })
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Does temperature affect it?',
      action: 'none',
      slideId: mixed._id,
      startMs: 600_500,
      endMs: 601_000,
      words: [{ word: 'Does', startMs: 600_500, endMs: 601_000 }],
    })

    const run = async () => {
      const start = await act(ada, 'deck.refine', {
        deckId,
        identifySpeakers: true,
        refineTranscript: { level: 2 },
      })
      return awaitJob(start.body.jobId as string)
    }

    await run()
    const first = (await SlideModel.findById(mixed._id))?.sourceTranscript
    // Attribution lands at the student turn; the lecturer span stays
    // authoritative (it comes first, with no student prefix).
    expect(first).toContain('Water crosses membranes')
    expect(first).toContain('A student asked: Does temperature affect it?')
    expect(first).not.toMatch(/^A student asked:/)

    // Re-running Refine yields byte-identical narration — regenerated from the
    // stable segments and short-circuited by the input-hash guard (no
    // compounding double-attribution).
    await run()
    const second = (await SlideModel.findById(mixed._id))?.sourceTranscript
    expect(second).toBe(first)
  })

  // The lecture-wide pass takes the same text/layout/imagery split the
  // per-slide dialog sends, so a UI for it here is a UI change only.
  it('honors a narrowed slide pass across every slide', async () => {
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide')
    for (const [index, title] of ['One', 'Two'].entries())
      await SlideModel.create({
        deckId,
        index,
        layoutType: 'content',
        title,
        body: 'Body',
      })

    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: {
        level: 3,
        parts: { text: true, layout: false, imagery: false },
      },
    })
    const done = await awaitJob(body.jobId)
    expect(done.summary.slidesRefined).toBe(2)

    // Every slide was refined, and none was offered a layout to move to.
    expect(refine).toHaveBeenCalledTimes(2)
    for (const [request] of refine.mock.calls)
      expect(request.layoutDescriptors.map(d => d.type)).toEqual(['content'])
    refine.mockRestore()
  })

  /**
   * Breaking slides up across a whole lecture (GEN-4).
   *
   * The batch pass used to drop every proposal, because a background job has
   * nowhere to ask. The permission now arrives with the request, so the job
   * writes the split — and the thing to check is the DECK, not the summary: a
   * count that says "1" while the parts were never created reports exactly
   * what success reports.
   *
   * The mock provider proposes a split for any slide of three or more
   * bullets, and only when asked.
   */
  const seedSplittable = async () => {
    const wide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['Absorption', 'Transfer', 'Fixation'],
    })
    const plain = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'content',
      title: 'Summary',
      body: 'One idea',
    })
    await DeckModel.updateOne(
      { _id: deckId },
      { slideOrder: [wide._id.toString(), plain._id.toString()] },
    )
    return { wide: wide._id.toString(), plain: plain._id.toString() }
  }

  it('breaks a slide up when the run allowed it, and says how many', async () => {
    const { wide, plain } = await seedSplittable()

    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 3, allowSplit: true },
    })
    const done = await awaitJob(body.jobId)
    expect(done.summary.slidesSplit).toBe(1)

    // The parts are real slides, placed after the original, which kept its id.
    const deck = await DeckModel.findById(deckId)
    expect(deck?.slideOrder).toHaveLength(4)
    expect(deck?.slideOrder[0]).toBe(wide)
    expect(deck?.slideOrder[3]).toBe(plain)
    const slides = await SlideModel.find({ deckId }).sort({ index: 1 })
    expect(slides.map(s => s.title)).toEqual([
      'Stages (1)',
      'Stages (2)',
      'Stages (3)',
      'Summary',
    ])
    // index agrees with position, as every other reorder guarantees.
    expect(slides.map(s => s.index)).toEqual([0, 1, 2, 3])
  })

  it('gives every new part its own narration', async () => {
    // A part with no narration is a slide TTS cannot read. The transcript pass
    // is off here: the parts must be narrated because they are new, not
    // because everything was.
    await seedSplittable()
    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 3, allowSplit: true },
    })
    await awaitJob(body.jobId)

    const parts = await SlideModel.find({ deckId, title: /^Stages/ })
    expect(parts).toHaveLength(3)
    for (const part of parts) expect(part.sourceTranscript).toBeTruthy()
  })

  it('does not re-refine the parts it just made', async () => {
    // The parts are already the refined text. Refining them again would
    // rework what was just written — and could split it a second time.
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide')
    await seedSplittable()

    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 3, allowSplit: true },
    })
    await awaitJob(body.jobId)
    // The two slides the lecture had when the pass began, and no more.
    expect(refine).toHaveBeenCalledTimes(2)
    refine.mockRestore()
  })

  it('leaves the lecture whole when the run did not allow a split', async () => {
    // Which is the default, and the case that must never surprise anyone.
    const { wide } = await seedSplittable()
    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 3 },
    })
    const done = await awaitJob(body.jobId)
    expect(done.summary.slidesSplit).toBe(0)

    const deck = await DeckModel.findById(deckId)
    expect(deck?.slideOrder).toHaveLength(2)
    const w = await SlideModel.findById(wide)
    expect(w?.bullets).toEqual(['Absorption', 'Transfer', 'Fixation'])
  })

  /**
   * Reporting which slide is being refined.
   *
   * A pass over a long lecture is minutes of silence otherwise, and
   * "working in the background" reads the same whether it is progressing or
   * has hung. Caught mid-run rather than after it: a finished job reports no
   * progress at all, so polling only at the end would find nothing and prove
   * nothing.
   */
  it('reports the slide it is working on while it runs', async () => {
    const gen = registry.get<GenerationProvider>('generation')
    // Hold the first slide open so there is a mid-run moment to observe.
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const original = gen.refineSlide.bind(gen)
    const refine = vi
      .spyOn(gen, 'refineSlide')
      .mockImplementationOnce(async req => {
        await held
        return original(req)
      })

    for (const [index, title] of ['Photosynthesis', 'Respiration'].entries())
      await SlideModel.create({
        deckId,
        index,
        layoutType: 'content',
        title,
        body: 'Body',
      })

    const { body } = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 3 },
    })
    const jobId = body.jobId as string

    const mid = await vi.waitFor(
      async () => {
        const res = await act(ada, 'deck.refineStatus', { jobId })
        expect(res.body.progress?.index).toBeDefined()
        return res.body.progress
      },
      { timeout: 5000, interval: 25 },
    )
    expect(mid).toMatchObject({
      phase: 'slides',
      index: 1,
      total: 2,
      title: 'Photosynthesis',
    })

    release()
    const done = await awaitJob(jobId)
    // Finished work is described by the summary; nothing is still in flight.
    expect(done.progress).toBeUndefined()
    refine.mockRestore()
  })

  it("403s refining another user's deck, and hides its job status", async () => {
    const bob = await registerUser('bob@example.com')
    expect((await act(bob, 'deck.refine', { deckId })).status).toBe(403)

    const start = await act(ada, 'deck.refine', {
      deckId,
      refineTranscript: { level: 1 },
    })
    const jobId = start.body.jobId as string
    expect((await act(bob, 'deck.refineStatus', { jobId })).status).toBe(403)
  })
})
