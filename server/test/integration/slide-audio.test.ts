/**
 * Integration test for per-slide original-audio playback (GEN-4): the deck
 * view reports which slides have retained audio (editors only), and
 * GET /api/slides/:slideId/audio stitches the slide's timed segments out of the
 * session WAV into a gated WAV clip. MongoDB real; local storage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { getStorage } from '../../src/storage'
import { pcmToWav } from '../../src/lib/wav'
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

/** supertest parser that collects a binary response body into a Buffer. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2

let ada: string
let deckId: string
let slug: string

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
  slug = deck.body.permalinkSlug
})

/**
 * Seeds a slide plus one 2-second session WAV in storage, and a segment of the
 * slide covering [startMs, endMs]. Returns the slide id.
 */
const seedSlideWithAudio = async (
  startMs: number,
  endMs: number,
): Promise<string> => {
  const slide = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    title: 'Photosynthesis',
  })
  // 2 s of silence: 16k samples/s * 2 bytes * 2 s.
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
    startMs,
    endMs,
    words: [{ word: 'Plants', startMs, endMs }],
  })
  return slide._id.toString()
}

describe('per-slide original audio', () => {
  it('lists the slide under audioSlideIds for an editor', async () => {
    const slideId = await seedSlideWithAudio(0, 500)
    const res = await request(server)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${ada}`)
    expect(res.status).toBe(200)
    expect(res.body.audioSlideIds).toEqual([slideId])
  })

  it('serves a WAV clip of exactly the slide segment', async () => {
    const slideId = await seedSlideWithAudio(0, 500)
    const res = await request(server)
      .get(`/api/slides/${slideId}/audio`)
      .set('Authorization', `Bearer ${ada}`)
      .buffer(true)
      .parse(binary)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/audio\/wav/)
    // The segment is [0, 500] ms, plus a 400 ms tail pad so the last word is
    // not clipped → 900 ms at 16 kHz mono 16-bit, plus the 44-byte header.
    const expectedPcm = Math.floor((900 / 1000) * SAMPLE_RATE) * BYTES_PER_SAMPLE
    expect(res.body.length).toBe(44 + expectedPcm)
  })

  it('404s when the slide has no retained audio', async () => {
    // Slide with a segment but no recording on the deck.
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'No audio',
    })
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'sess-gone',
      text: 'typed',
      action: 'new',
      slideId: slide._id,
      startMs: 0,
      endMs: 500,
      words: [{ word: 'typed', startMs: 0, endMs: 500 }],
    })
    const res = await request(server)
      .get(`/api/slides/${slide._id.toString()}/audio`)
      .set('Authorization', `Bearer ${ada}`)
    expect(res.status).toBe(404)
  })

  it('hides audio from non-editors', async () => {
    const slideId = await seedSlideWithAudio(0, 500)
    // Make the deck public so a stranger can view it, but not edit.
    await DeckModel.updateOne({ _id: deckId }, { visibility: 'public' })
    const bob = await registerUser('bob@example.com')

    // The stranger's deck view omits the audio ids.
    const view = await request(server)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${bob}`)
    expect(view.status).toBe(200)
    expect(view.body.audioSlideIds).toEqual([])

    // And the audio endpoint is forbidden.
    const audio = await request(server)
      .get(`/api/slides/${slideId}/audio`)
      .set('Authorization', `Bearer ${bob}`)
    expect(audio.status).toBe(403)
  })
})
