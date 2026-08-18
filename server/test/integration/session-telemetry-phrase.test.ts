/**
 * Integration tests for session.phrase's telemetry writes (SPEC EVAL-1):
 * one phrase row per live phrase with its outcome and generation latency,
 * error rows on provider failure, the refusal tally, and — just as load-
 * bearing — silence for typed input that has no session.
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
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { SessionTelemetryEventModel } from '../../src/models/session-telemetry-event'
import { registry } from '../../src/providers/registry'
import { GenerationUnavailableError } from '../../src/providers/errors'
import { noteGenerationRefusal } from '../../src/telemetry/generation-signals'
import type { GenerationProvider } from '@slide-machine/shared'

const server = createApp().listen(0)

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

/** The recorder is fire-and-forget; give its create a beat to land. */
const settle = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))

const rowsFor = (sessionId: string) =>
  SessionTelemetryEventModel.find({ sessionId }).sort({ at: 1, _id: 1 })

let ada: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), SessionTelemetryEventModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    SessionTelemetryEventModel.deleteMany({}),
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

describe('session.phrase telemetry', () => {
  it('writes a phrase row with outcome and latency for a new slide', async () => {
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a strong protective barrier',
      sessionId: 'sess-new',
    })
    expect(res.body.kind).toBe('slide.new')
    await settle()

    const rows = await rowsFor('sess-new')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'phrase', outcome: 'new' })
    expect(rows[0]!.generationMs).toBeGreaterThanOrEqual(0)
    expect(rows[0]!.deckId?.toString()).toBe(deckId)
  })

  it('classifies filler as none and an addition as update', async () => {
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a strong protective barrier',
      sessionId: 'sess-mix',
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'um let me think about that for a second',
      sessionId: 'sess-mix',
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'also it regulates what enters and leaves the cell',
      sessionId: 'sess-mix',
    })
    await settle()

    const rows = await rowsFor('sess-mix')
    expect(rows.map(r => r.outcome)).toEqual(['new', 'none', 'update'])
  })

  it('writes a phrase row with no latency on the paused fast path', async () => {
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a strong protective barrier',
      sessionId: 'sess-pause',
    })
    const paused = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'this phrase lands while the speaker is drawing',
      sessionId: 'sess-pause',
      pauseGeneration: true,
    })
    expect(paused.body.kind).toBe('none')
    await settle()

    const rows = await rowsFor('sess-pause')
    expect(rows).toHaveLength(2)
    expect(rows[1]!.outcome).toBe('none')
    // Voice commands are off in tests, so the fast path skipped the model.
    expect(rows[1]!.generationMs).toBeUndefined()
  })

  it('records an unavailable generation error and still rejects the action', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    vi.spyOn(provider, 'generateSlideContent').mockRejectedValueOnce(
      new GenerationUnavailableError('quota exhausted', false),
    )
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'This phrase will not survive the provider',
      sessionId: 'sess-down',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    await settle()

    const rows = await rowsFor('sess-down')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'generation_error',
      errorKind: 'unavailable',
      retryable: false,
    })
  })

  it('records any other generation failure as a plain error', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    vi.spyOn(provider, 'generateSlideContent').mockRejectedValueOnce(
      new Error('model returned garbage'),
    )
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Another doomed phrase',
      sessionId: 'sess-err',
    })
    await settle()

    const rows = await rowsFor('sess-err')
    expect(rows[0]).toMatchObject({
      kind: 'generation_error',
      errorKind: 'error',
      errorMessage: 'model returned garbage',
    })
  })

  it('carries the refusal tally noted inside the generation scope', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    vi.spyOn(provider, 'generateSlideContent').mockImplementationOnce(
      async req => {
        noteGenerationRefusal(2)
        return original(req)
      },
    )
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The Krebs cycle produces ATP in the mitochondria',
      sessionId: 'sess-refuse',
    })
    await settle()

    const rows = await rowsFor('sess-refuse')
    expect(rows[0]).toMatchObject({ kind: 'phrase', refusals: 2 })
  })

  it('writes nothing for typed input that carries no sessionId', async () => {
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'A phrase typed into the Speak bar',
    })
    expect(res.body.kind).toBe('slide.new')
    await settle()

    expect(await SessionTelemetryEventModel.countDocuments({})).toBe(0)
  })
})
