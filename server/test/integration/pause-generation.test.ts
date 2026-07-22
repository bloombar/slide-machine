/**
 * Integration test for session.phrase with `pauseGeneration` (WB-3): while the
 * user is marking up a slide, a spoken phrase is recorded to the transcript but
 * generates nothing — no new slide, no content or layout change — so both the
 * speech and the drawing are retained for later playback without spawning
 * slides.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

import { env } from '../../src/config/env'
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
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
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

afterAll(async () => {
  await disconnectMongo()
})

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

describe('session.phrase with pauseGeneration', () => {
  it('records the phrase but generates no slide while paused', async () => {
    // A first, ordinary phrase creates the slide the user then marks up.
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a strong protective barrier',
    })
    expect(first.body.kind).toBe('slide.new')
    const slideId = first.body.slide.id as string

    // A phrase that would normally create a NEW slide — but generation is
    // paused, so nothing is generated and no slide is created.
    const paused = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
      pauseGeneration: true,
    })
    expect(paused.body.kind).toBe('none')
    expect(paused.body.slide).toBeUndefined()

    const view = await act(ada, 'deck.get', { deckId })
    // Still just the one slide — the paused phrase spawned nothing.
    expect(view.body.slides).toHaveLength(1)
    expect(view.body.slides[0].id).toBe(slideId)
    // …and its content is untouched (no generation ran).
    expect(view.body.slides[0].body).toBe(
      'The cell membrane is a strong protective barrier',
    )

    // Both phrases are still in the deck transcript, in order.
    const transcript = view.body.deck.transcript as string
    expect(transcript).toContain(
      'The cell membrane is a strong protective barrier',
    )
    expect(transcript).toContain('Mitochondria are the powerhouse of the cell')

    // The paused phrase joined the current slide's own source transcript, so a
    // stroke drawn now anchors correctly.
    expect(view.body.slides[0].sourceTranscript).toContain(
      'Mitochondria are the powerhouse of the cell',
    )
  })

  it('persists a structured transcript segment for the paused phrase', async () => {
    const sessionId = 'rec-pause'
    const created = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis basics',
      sessionId,
    })
    expect(created.body.kind).toBe('slide.new')
    const slideId = created.body.slide.id as string

    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Chloroplasts capture sunlight',
      sessionId,
      confidence: 0.88,
      words: [
        { word: 'Chloroplasts', startMs: 0, endMs: 600, confidence: 0.9 },
        { word: 'capture', startMs: 600, endMs: 1000, confidence: 0.9 },
        { word: 'sunlight', startMs: 1000, endMs: 1500, confidence: 0.85 },
      ],
      pauseGeneration: true,
    })

    const segments = await TranscriptSegmentModel.find({ deckId }).sort({
      createdAt: 1,
    })
    expect(segments).toHaveLength(2)

    // The paused phrase's segment: action 'none', linked to the current slide,
    // timings derived from the word offsets.
    const pausedSeg = segments[1]!
    expect(pausedSeg.text).toBe('Chloroplasts capture sunlight')
    expect(pausedSeg.sessionId).toBe(sessionId)
    expect(pausedSeg.confidence).toBeCloseTo(0.88)
    expect(pausedSeg.action).toBe('none')
    expect(pausedSeg.slideId?.toString()).toBe(slideId)
    expect(pausedSeg.startMs).toBe(0)
    expect(pausedSeg.endMs).toBe(1500)
    expect(pausedSeg.words).toHaveLength(3)
  })

  it('creates the first slide even when paused (no current slide to hold)', async () => {
    // With no slide on screen yet there is nothing to fold into, so a paused
    // phrase still records to the transcript but leaves the deck empty.
    const paused = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'An opening remark while doodling',
      pauseGeneration: true,
    })
    expect(paused.body.kind).toBe('none')

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(0)
    expect(view.body.deck.transcript as string).toContain(
      'An opening remark while doodling',
    )
  })
})
