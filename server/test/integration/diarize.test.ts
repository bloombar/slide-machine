/**
 * Integration test for deck.diarize (GEN-4 Phase 3, mock diarizer). Given a
 * deck with a recording and timed transcript segments, the action time-joins
 * the mock's scripted speakers onto the segments and tags each with a speaker
 * and a lecturer/student role. MongoDB is real; DIARIZATION_PROVIDER=mock.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import request from 'supertest'
import type { DiarizationProvider } from '@slide-machine/shared'
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
import { UsageRecordModel } from '../../src/models/usage-record'
import { capFor, recordUsage, usedThisPeriod } from '../../src/billing/usage'

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
let adaId: string
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
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('deck.diarize', () => {
  it('tags segments with speaker + role from the diarized recording', async () => {
    // One recording; the mock diarizer scripts speaker 1 (lecturer, 0–600s)
    // and speaker 2 (student, 600–620s).
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
    const lectured = await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Photosynthesis basics',
      action: 'new',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Photosynthesis', startMs: 0, endMs: 1000 }],
    })
    const asked = await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is that always true?',
      action: 'none',
      startMs: 600_500,
      endMs: 601_000,
      words: [{ word: 'Is', startMs: 600_500, endMs: 601_000 }],
    })

    const res = await act(ada, 'deck.diarize', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sessionsProcessed: 1, segmentsTagged: 2 })

    const lec = await TranscriptSegmentModel.findById(lectured._id)
    expect(lec?.speaker).toBe(1)
    expect(lec?.role).toBe('lecturer')

    const stu = await TranscriptSegmentModel.findById(asked._id)
    expect(stu?.speaker).toBe(2)
    expect(stu?.role).toBe('student')
  })

  it('is a no-op for a deck with no recordings', async () => {
    const res = await act(ada, 'deck.diarize', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sessionsProcessed: 0, segmentsTagged: 0 })
  })

  it("403s diarizing another user's deck", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'deck.diarize', { deckId })
    expect(res.status).toBe(403)
  })
})

/**
 * Diarization bills per minute of audio at the same rate as live capture, and
 * per-slide speaker identification runs this pass once per slide — so a
 * re-diarized recording is a real, repeated charge, not just wasted time. The
 * speaker turns are cached on the recording and reused.
 */
describe('deck.diarize caching', () => {
  /** A recording plus one timed segment, the minimum for a pass to do work. */
  const seedRecording = async (sessionId = 'rec-1') => {
    await DeckModel.updateOne(
      { _id: deckId },
      {
        $push: {
          recordings: {
            sessionId,
            audioKey: 'audio/x.wav',
            sampleRate: 16_000,
            durationMs: 620_000,
            createdAt: new Date(),
          },
        },
      },
    )
    return TranscriptSegmentModel.create({
      deckId,
      sessionId,
      text: 'Photosynthesis basics',
      action: 'new',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Photosynthesis', startMs: 0, endMs: 1000 }],
    })
  }

  const recordingOf = async (deck = deckId) =>
    (await DeckModel.findById(deck))?.recordings?.[0]

  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    const provider = registry.get<DiarizationProvider>('diarization')
    spy = vi.spyOn(provider, 'diarize')
  })
  afterEach(() => spy.mockRestore())

  it("stores the diarizer's speaker turns on the recording", async () => {
    await seedRecording()

    await act(ada, 'deck.diarize', { deckId })

    const rec = await recordingOf()
    expect(rec?.diarizedBy).toBe('mock')
    expect(rec?.diarizedAt).toBeInstanceOf(Date)
    // Mapped to plain objects: these are mongoose subdocuments, which carry
    // internals that a deep-equality check would trip over.
    expect(
      rec?.diarization?.map(d => ({
        speaker: d.speaker,
        startMs: d.startMs,
        endMs: d.endMs,
      })),
    ).toEqual([
      { speaker: 1, startMs: 0, endMs: 600_000 },
      { speaker: 2, startMs: 600_000, endMs: 620_000 },
    ])
  })

  it('re-tags from the cache instead of submitting the audio again', async () => {
    const segment = await seedRecording()

    const first = await act(ada, 'deck.diarize', { deckId })
    const second = await act(ada, 'deck.diarize', { deckId })

    // Same answer both times, but the paid call happened only once.
    expect(second.body).toEqual(first.body)
    expect(spy).toHaveBeenCalledTimes(1)

    // The second pass still tagged from the cached intervals.
    const tagged = await TranscriptSegmentModel.findById(segment._id)
    expect(tagged?.speaker).toBe(1)
    expect(tagged?.role).toBe('lecturer')
  })

  it('re-diarizes when a different engine produced the cache', async () => {
    await seedRecording()
    // A developer who ran the mock, then configured a real engine, must not
    // inherit scripted intervals as though they described the audio.
    await act(ada, 'deck.diarize', { deckId })
    await DeckModel.updateOne(
      { _id: deckId, 'recordings.sessionId': 'rec-1' },
      { $set: { 'recordings.$.diarizedBy': 'some-other-engine' } },
    )

    await act(ada, 'deck.diarize', { deckId })

    expect(spy).toHaveBeenCalledTimes(2)
    expect((await recordingOf())?.diarizedBy).toBe('mock')
  })

  it('caches each recording separately', async () => {
    await seedRecording('rec-1')
    await seedRecording('rec-2')

    await act(ada, 'deck.diarize', { deckId })
    await act(ada, 'deck.diarize', { deckId })

    // Two recordings diarized once each, not twice each.
    expect(spy).toHaveBeenCalledTimes(2)
    const deck = await DeckModel.findById(deckId)
    expect(deck?.recordings?.map(r => r.diarizedBy)).toEqual(['mock', 'mock'])
  })
})

/**
 * Diarization metering (BILL-3). The minutes submitted are charged to whoever
 * ran the pass; a pass served from the cache submits nothing, so it is recorded
 * without being debited.
 */
describe('deck.diarize metering', () => {
  /** A recording plus one timed segment, the minimum for a pass to do work. */
  const seedRecording = async (durationMs = 620_000) => {
    await DeckModel.updateOne(
      { _id: deckId },
      {
        $push: {
          recordings: {
            sessionId: 'rec-1',
            audioKey: 'audio/x.wav',
            sampleRate: 16_000,
            durationMs,
            createdAt: new Date(),
          },
        },
      },
    )
    return TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Photosynthesis basics',
      action: 'new',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Photosynthesis', startMs: 0, endMs: 1000 }],
    })
  }

  it('charges the audio’s duration in minutes', async () => {
    await seedRecording(600_000) // exactly ten minutes

    await act(ada, 'deck.diarize', { deckId })

    expect(await usedThisPeriod(adaId, 'diarizationMinutes')).toBeCloseTo(10, 5)
  })

  it('does not charge again when the pass is served from cache', async () => {
    await seedRecording(600_000)

    await act(ada, 'deck.diarize', { deckId })
    await act(ada, 'deck.diarize', { deckId })

    // Recorded twice, debited once: the second pass re-tagged from stored
    // intervals and submitted no audio.
    expect(await usedThisPeriod(adaId, 'diarizationMinutes')).toBeCloseTo(10, 5)
    expect(
      await UsageRecordModel.countDocuments({
        userId: adaId,
        metric: 'diarizationMinutes',
      }),
    ).toBe(1)
  })

  it('402s once the allowance is spent, without submitting the audio', async () => {
    await seedRecording()
    await recordUsage(
      adaId,
      'diarizationMinutes',
      capFor('free', 'diarizationMinutes')!,
    )
    const provider = registry.get<DiarizationProvider>('diarization')
    const spy = vi.spyOn(provider, 'diarize')

    const res = await act(ada, 'deck.diarize', { deckId })

    expect(res.status).toBe(402)
    expect(res.body.error.details).toEqual(['diarizationMinutes'])
    // Checked before the submit, so an exhausted allowance costs nothing.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('still re-tags from the cache after the allowance is spent', async () => {
    // Work already paid for keeps working: hitting a cap degrades what can be
    // created, never what already exists (BILL-4).
    const segment = await seedRecording()
    await act(ada, 'deck.diarize', { deckId })
    await recordUsage(
      adaId,
      'diarizationMinutes',
      capFor('free', 'diarizationMinutes')!,
    )

    const res = await act(ada, 'deck.diarize', { deckId })

    expect(res.status).toBe(200)
    expect((await TranscriptSegmentModel.findById(segment._id))?.speaker).toBe(
      1,
    )
  })
})
