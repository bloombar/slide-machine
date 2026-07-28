/**
 * Integration tests for slide/deck text-to-speech (TECH-8): the mock TTS
 * provider synthesizes silent audio so the full synthesize → store → serve
 * path runs offline. Covers content vs transcript modes, Gemini narration for
 * a transcript-less slide (with caching that avoids re-narrating), the
 * nothing-to-say case, and view-access enforcement.
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
import { Types } from 'mongoose'

// Force the mock TTS adapter (no paid API) and enable Gemini narration.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TTS_PROVIDER: 'mock', GEMINI_API_KEY: 'test-key' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) throw new Error(`registration failed: ${res.status}`)
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const tts = (token: string, slideId: string, mode: string, text?: string) =>
  request(server)
    .post(`/api/slides/${slideId}/tts`)
    .set('Authorization', `Bearer ${token}`)
    .send(text === undefined ? { mode } : { mode, text })

let ada: string
let deckId: string
let projectId: string

/** A Gemini narration reply for the transcript-less case. */
const narrationReply = () => ({
  ok: true,
  json: async () => ({
    candidates: [
      { content: { parts: [{ text: 'A spoken narration of the slide.' }] } },
    ],
  }),
})

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => await disconnectMongo())
afterEach(() => vi.unstubAllGlobals())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio' })
  projectId = project.body.id
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'L1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

const makeSlide = async (fields: {
  title?: string
  body?: string
  sourceTranscript?: string
}): Promise<string> => {
  const slide = await SlideModel.create({
    deckId: new Types.ObjectId(deckId),
    index: 0,
    layoutType: 'content',
    ...fields,
  })
  return slide._id.toString()
}

describe('POST /slides/:slideId/tts', () => {
  it('synthesizes a slide-content audio url', async () => {
    const slideId = await makeSlide({ title: 'Mitochondria', body: 'The cell' })
    const res = await tts(ada, slideId, 'content')
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^\/api\/files\/tts\/[a-f0-9]+\.wav$/)
  })

  it('reads the stored transcript in transcript mode', async () => {
    const slideId = await makeSlide({
      title: 'X',
      sourceTranscript: 'What the lecturer actually said here.',
    })
    const res = await tts(ada, slideId, 'transcript')
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/\.wav$/)
  })

  it('narrates a transcript-less slide via Gemini and caches it', async () => {
    const fetchMock = vi.fn(async () => narrationReply() as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    // Unique content → a fresh cache key each run, so the first call always
    // narrates (the audio cache persists on disk across test runs).
    const uniq = Math.random().toString(36).slice(2)
    const slideId = await makeSlide({ title: 'Osmosis', body: `Water ${uniq}` })

    const first = await tts(ada, slideId, 'transcript')
    expect(first.status).toBe(200)
    expect(first.body.url).toMatch(/\.wav$/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // narration synthesized once

    // Second identical request is a cache hit — no re-narration.
    const second = await tts(ada, slideId, 'transcript')
    expect(second.body.url).toBe(first.body.url)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a null url when there is nothing to speak', async () => {
    const slideId = await makeSlide({})
    const res = await tts(ada, slideId, 'content')
    expect(res.status).toBe(200)
    expect(res.body.url).toBeNull()
  })

  it('caches per voice — a different voice yields a different url', async () => {
    const slideId = await makeSlide({ title: 'Cells', body: 'Overview' })
    await act(ada, 'deck.setTtsVoice', { deckId, voice: 'emma' })
    const a = await tts(ada, slideId, 'content')
    await act(ada, 'deck.setTtsVoice', { deckId, voice: 'james' })
    const b = await tts(ada, slideId, 'content')
    expect(a.body.url).toMatch(/\.wav$/)
    expect(b.body.url).not.toBe(a.body.url)
  })

  it('rejects an unknown voice id', async () => {
    const res = await act(ada, 'deck.setTtsVoice', {
      deckId,
      voice: 'not-a-voice',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  // The transcript editor previews unsaved narration through this same
  // endpoint (EDIT-6).
  it('speaks supplied text instead of what the slide stores', async () => {
    const uniq = Math.random().toString(36).slice(2)
    const slideId = await makeSlide({
      title: 'X',
      sourceTranscript: `The stored narration ${uniq}.`,
    })
    const stored = await tts(ada, slideId, 'transcript')
    const preview = await tts(
      ada,
      slideId,
      'transcript',
      `An unsaved rewrite ${uniq}.`,
    )
    expect(preview.status).toBe(200)
    expect(preview.body.url).toMatch(/\.wav$/)
    // Different words, different audio — the preview is of what was typed.
    expect(preview.body.url).not.toBe(stored.body.url)

    // Saving those words and playing them back reuses the preview's audio, so
    // the preview costs nothing the eventual playback wouldn't have.
    await act(ada, 'slide.editTranscript', {
      slideId,
      transcript: `An unsaved rewrite ${uniq}.`,
    })
    const afterSave = await tts(ada, slideId, 'transcript')
    expect(afterSave.body.url).toBe(preview.body.url)
  })

  it('returns a null url for text with nothing to say', async () => {
    const slideId = await makeSlide({ title: 'X', body: 'Has content' })
    const res = await tts(ada, slideId, 'transcript', '   ')
    expect(res.status).toBe(200)
    // Not a fallback to the slide's content: an empty preview speaks nothing.
    expect(res.body.url).toBeNull()
  })

  it('rejects narration longer than a transcript could ever be', async () => {
    const slideId = await makeSlide({ title: 'X' })
    const res = await tts(ada, slideId, 'transcript', 'a'.repeat(20001))
    expect(res.status).toBe(400)
  })

  // Speaking supplied words spends a paid API call on text the caller wrote,
  // so it takes edit rights — unlike listening to what a lecture already says.
  it('403s a viewer who supplies text, while still letting them listen', async () => {
    const slideId = await makeSlide({
      title: 'Public',
      sourceTranscript: 'Anyone may hear this.',
    })
    const bob = await registerUser('viewer@example.com')

    const listening = await tts(bob, slideId, 'transcript')
    expect(listening.status).toBe(200)

    const supplying = await tts(bob, slideId, 'transcript', 'My own words.')
    expect(supplying.status).toBe(403)
  })

  it('403s for someone without view access', async () => {
    // Decks are public by default; restrict it so a stranger cannot listen.
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    const slideId = await makeSlide({ title: 'Private' })
    const bob = await registerUser('bob@example.com')
    const res = await tts(bob, slideId, 'content')
    expect(res.status).toBe(403)
  })
})
