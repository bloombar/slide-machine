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
import { env } from '../../src/config/env'
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
