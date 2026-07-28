/**
 * Integration test for re-transcribing a slide from its recorded audio
 * (GEN-4/EDIT-6): slide.regenerateTranscript runs the speech engine over the
 * audio retained for that slide, returns the text without touching the slide by
 * default, and writes it (re-anchoring whiteboard marks) when asked to save.
 * Slides with no audio, and non-editors, are refused. MongoDB real; local
 * storage; the mock speech engine stands in for a real one.
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

// The test env leaves TRANSCRIPTION_PROVIDER at its keyless 'browser' default,
// which by design cannot transcribe server-side. Point it at the deterministic
// mock engine for this suite.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TRANSCRIPTION_PROVIDER: 'mock' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { getStorage } from '../../src/storage'
import { pcmToWav } from '../../src/lib/wav'
import { registry } from '../../src/providers/registry'
import { MockTranscriptionProvider } from '../../src/providers/mock-transcription'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

registry.register(
  'transcription',
  env.TRANSCRIPTION_PROVIDER,
  () => new MockTranscriptionProvider(),
)
/** What the mock engine transcribes any audio to. */
const HEARD = 'Photosynthesis basics'

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

const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2

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

/**
 * Seeds a slide carrying `transcript`, a 2-second session WAV in storage, and a
 * timed segment of the slide covering the first half second of it.
 */
const seedSlideWithAudio = async (transcript: string): Promise<string> => {
  const slide = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    title: 'Photosynthesis',
    sourceTranscript: transcript,
  })
  const pcm = Buffer.alloc(SAMPLE_RATE * BYTES_PER_SAMPLE * 2)
  const audioKey = `audio/${deckId}/session.wav`
  await getStorage().put(audioKey, pcmToWav(pcm, SAMPLE_RATE), 'audio/wav')
  await DeckModel.updateOne(
    { _id: deckId },
    {
      $push: {
        recordings: {
          sessionId: 'sess-1',
          audioKey,
          sampleRate: SAMPLE_RATE,
          durationMs: 2000,
          createdAt: new Date(),
        },
      },
    },
  )
  await TranscriptSegmentModel.create({
    deckId,
    sessionId: 'sess-1',
    text: 'Plants convert light',
    action: 'new',
    slideId: slide._id,
    startMs: 0,
    endMs: 500,
    words: [{ word: 'Plants', startMs: 0, endMs: 500 }],
  })
  return slide._id.toString()
}

describe('slide.regenerateTranscript', () => {
  it('returns the re-transcribed text without changing the slide', async () => {
    const slideId = await seedSlideWithAudio('The typo-ridden original.')
    const res = await act(ada, 'slide.regenerateTranscript', { slideId })

    expect(res.status).toBe(200)
    expect(res.body.transcript).toBe(HEARD)
    // Nothing is saved until the user accepts it in the editor.
    expect(res.body.slide).toBeUndefined()
    const slide = await SlideModel.findById(slideId)
    expect(slide!.sourceTranscript).toBe('The typo-ridden original.')
  })

  it('writes the text and returns the refreshed slide when asked to save', async () => {
    const slideId = await seedSlideWithAudio('The typo-ridden original.')
    const res = await act(ada, 'slide.regenerateTranscript', {
      slideId,
      save: true,
    })

    expect(res.status).toBe(200)
    expect(res.body.transcript).toBe(HEARD)
    expect(res.body.slide.sourceTranscript).toBe(HEARD)
    const slide = await SlideModel.findById(slideId)
    expect(slide!.sourceTranscript).toBe(HEARD)
  })

  it('re-anchors the slide’s whiteboard marks onto the new text', async () => {
    const slideId = await seedSlideWithAudio('A much longer original sentence.')
    await SlideModel.updateOne(
      { _id: slideId },
      {
        drawings: [
          {
            id: 'stroke-1',
            tool: 'pen',
            color: '#1e293b',
            thickness: 0.01,
            points: [{ x: 0.2, y: 0.3 }],
            startedAt: '2026-07-21T10:00:00.000Z',
            endedAt: '2026-07-21T10:00:01.000Z',
            // Two thirds through the old text, with no phrase fingerprint, so
            // it re-anchors proportionally rather than semantically.
            anchor: { charAnchor: 21, source: 'word' },
          },
        ],
      },
    )

    await act(ada, 'slide.regenerateTranscript', { slideId, save: true })

    const slide = await SlideModel.findById(slideId)
    const anchor = slide!.drawings![0]!.anchor
    // The mark still points inside the new (shorter) transcript.
    expect(anchor.charAnchor).toBeLessThanOrEqual(HEARD.length)
    expect(anchor.charAnchor).toBeGreaterThan(0)
  })

  it('404s for a slide with no retained audio', async () => {
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'No audio',
    })
    const res = await act(ada, 'slide.regenerateTranscript', {
      slideId: slide._id.toString(),
    })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('no_audio')
  })

  it('refuses a user who cannot edit the lecture', async () => {
    const slideId = await seedSlideWithAudio('Original.')
    await DeckModel.updateOne({ _id: deckId }, { visibility: 'public' })
    const bob = await registerUser('bob@example.com')

    const res = await act(bob, 'slide.regenerateTranscript', { slideId })
    expect(res.status).toBe(403)
    const slide = await SlideModel.findById(slideId)
    expect(slide!.sourceTranscript).toBe('Original.')
  })
})
