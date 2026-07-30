/**
 * Integration tests for the process-wide audio-retention budget (GEN-4
 * Phase 2). The per-session cap bounds one recording; this bounds the process,
 * so N concurrent lectures cannot together exhaust memory. Exercised over the
 * real STT WebSocket with a deliberately tiny budget: audio is truncated or
 * declined, while transcription is never affected.
 *
 * Lives in its own file because the budget is module-level process state — the
 * sibling retention suite must not see reservations from these cases.
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
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'

// Retention on, a 1 MiB global ceiling, and an isolated storage dir.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      AUDIO_RETENTION_ENABLED: true,
      AUDIO_RETENTION_MAX_TOTAL_MB: 1,
      AUDIO_RETENTION_MAX_SESSION_MB: 300,
      STORAGE_LOCAL_DIR: '.uploads-audio-budget-test',
    },
  }
})

// Mock Google's streaming duplex (no real gRPC), like the sibling suites.
const { SpeechClient } = vi.hoisted(() => {
  class FakeRecognizeStream {
    write(): void {}
    end(): void {}
    destroy(): void {}
    on(): this {
      return this
    }
  }
  const SpeechClient = vi.fn(function () {
    return { streamingRecognize: () => new FakeRecognizeStream() }
  })
  return { SpeechClient }
})
vi.mock('@google-cloud/speech', () => ({ SpeechClient }))

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { attachAudioSocket } from '../../src/ws/audio-socket'
import { resetRetentionBudget } from '../../src/ws/retention-budget'
import { registry } from '../../src/providers/registry'
import { GoogleCloudTranscriptionProvider } from '../../src/providers/google-cloud-transcription'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { getStorage } from '../../src/storage'

const ONE_MB = 1024 * 1024
/** Frame size that divides 1 MiB evenly, so the budget fills exactly. */
const FRAME = 256 * 1024

const server = createApp().listen(0)
attachAudioSocket(server)
registry.register(
  'transcription',
  env.TRANSCRIPTION_PROVIDER,
  () => new GoogleCloudTranscriptionProvider(),
)

const port = (): number => (server.address() as AddressInfo).port

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

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))

/** Both ceilings are read per audio frame, so a case can retune them. */
const setLimits = (totalMb: number, sessionMb: number): void => {
  const limits = env as {
    AUDIO_RETENTION_MAX_TOTAL_MB: number
    AUDIO_RETENTION_MAX_SESSION_MB: number
  }
  limits.AUDIO_RETENTION_MAX_TOTAL_MB = totalMb
  limits.AUDIO_RETENTION_MAX_SESSION_MB = sessionMb
}

/** Opens an STT socket and sends the start control message. */
const openSession = async (
  token: string,
  deckId: string,
  sessionId: string,
): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/stt?token=${token}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  ws.send(
    JSON.stringify({
      type: 'start',
      languageCode: 'en-US',
      sampleRate: 16_000,
      deckId,
      sessionId,
    }),
  )
  await settle(30) // let the provider stream + retention state start
  return ws
}

/** Streams `bytes` of silence in FRAME-sized frames. */
const stream = async (ws: WebSocket, bytes: number): Promise<void> => {
  for (let sent = 0; sent < bytes; sent += FRAME) {
    ws.send(new Uint8Array(Math.min(FRAME, bytes - sent)))
    await settle(15)
  }
}

const newDeck = async (token: string, projectId: string, title: string) => {
  const deck = await act(token, 'deck.create', {
    projectId,
    title,
    templateId: 'classic',
  })
  return deck.body.id as string
}

const recordingsOf = async (deckId: string) =>
  (await DeckModel.findById(deckId))?.recordings ?? []

let ada: string
let projectId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  resetRetentionBudget()
  setLimits(1, 300) // 1 MiB global ceiling; per-session cap out of the way
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  projectId = project.body.id
})

describe('audio retention budget', () => {
  it('truncates a session that runs past the global ceiling', async () => {
    const deckId = await newDeck(ada, projectId, 'Long Lecture')
    const ws = await openSession(ada, deckId, 'rec-long')
    // Twice the budget: the first 1 MiB is retained, the rest dropped.
    await stream(ws, 2 * ONE_MB)
    ws.close()

    const recording = await vi.waitFor(async () => {
      const [rec] = await recordingsOf(deckId)
      expect(rec).toBeDefined()
      return rec!
    })

    const wav = await getStorage().get(recording.audioKey)
    expect(wav).not.toBeNull()
    // Truncated at the ceiling, not the 2 MiB streamed — and still a valid WAV.
    expect(wav!.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav!.length).toBe(44 + ONE_MB)
  })

  it('truncates one session at the configured per-session cap', async () => {
    // Global ceiling off, so only AUDIO_RETENTION_MAX_SESSION_MB can stop this.
    setLimits(0, 1)
    const deckId = await newDeck(ada, projectId, 'Marathon Lecture')
    const ws = await openSession(ada, deckId, 'rec-marathon')
    await stream(ws, 2 * ONE_MB)
    ws.close()

    const recording = await vi.waitFor(async () => {
      const [rec] = await recordingsOf(deckId)
      expect(rec).toBeDefined()
      return rec!
    })
    const wav = await getStorage().get(recording.audioKey)
    expect(wav!.length).toBe(44 + ONE_MB)
  })

  it('lets 0 disable the per-session cap, leaving only the global ceiling', async () => {
    setLimits(4, 0)
    const deckId = await newDeck(ada, projectId, 'Uncapped Lecture')
    const ws = await openSession(ada, deckId, 'rec-uncapped')
    // Past the old hardcoded behaviour's intent but under the global ceiling:
    // all of it is retained.
    await stream(ws, 2 * ONE_MB)
    ws.close()

    const recording = await vi.waitFor(async () => {
      const [rec] = await recordingsOf(deckId)
      expect(rec).toBeDefined()
      return rec!
    })
    const wav = await getStorage().get(recording.audioKey)
    expect(wav!.length).toBe(44 + 2 * ONE_MB)
  })

  it('declines retention for a session opened while the budget is spent', async () => {
    const heavyDeck = await newDeck(ada, projectId, 'Heavy Lecture')
    const lateDeck = await newDeck(ada, projectId, 'Late Lecture')

    // First session claims the whole budget and stays open.
    const heavy = await openSession(ada, heavyDeck, 'rec-heavy')
    await stream(heavy, ONE_MB)

    // A second concurrent session gets no retention at all — but the socket
    // stays healthy, which is what keeps its transcription running.
    const late = await openSession(ada, lateDeck, 'rec-late')
    await stream(late, 4 * FRAME)
    expect(late.readyState).toBe(WebSocket.OPEN)
    late.close()
    await settle(80)
    expect(await recordingsOf(lateDeck)).toHaveLength(0)

    // The first session is unharmed by the second's arrival.
    heavy.close()
    await vi.waitFor(async () =>
      expect(await recordingsOf(heavyDeck)).toHaveLength(1),
    )
  })

  it('frees the budget when audio is discarded for a non-editor', async () => {
    // Access is verified asynchronously, so a non-editor's audio IS buffered
    // (and charged to the budget) before being thrown away. If that discard
    // skipped the release, one unauthorized session would starve the budget
    // for the life of the process.
    const bob = await registerUser('bob@example.com')
    const bobProject = await act(bob, 'project.create', { title: 'Bob' })
    const bobDeck = await newDeck(bob, bobProject.body.id, 'Bob Lecture')

    const intruder = await openSession(ada, bobDeck, 'rec-intruder')
    await stream(intruder, ONE_MB)
    intruder.close()
    await settle(120)
    expect(await recordingsOf(bobDeck)).toHaveLength(0)

    // Budget released: Ada's own lecture still retains normally.
    const ownDeck = await newDeck(ada, projectId, 'Ada Lecture')
    const own = await openSession(ada, ownDeck, 'rec-own')
    await stream(own, 2 * FRAME)
    own.close()
    await vi.waitFor(async () =>
      expect(await recordingsOf(ownDeck)).toHaveLength(1),
    )
  })

  it('frees the budget once a session flushes, so later ones retain again', async () => {
    const firstDeck = await newDeck(ada, projectId, 'First Lecture')
    const first = await openSession(ada, firstDeck, 'rec-first')
    await stream(first, ONE_MB)
    first.close()
    // Wait for the flush — the release happens after the upload, so the budget
    // only reopens once the memory is genuinely gone.
    await vi.waitFor(async () =>
      expect(await recordingsOf(firstDeck)).toHaveLength(1),
    )

    const secondDeck = await newDeck(ada, projectId, 'Second Lecture')
    const second = await openSession(ada, secondDeck, 'rec-second')
    await stream(second, 2 * FRAME)
    second.close()

    const recording = await vi.waitFor(async () => {
      const [rec] = await recordingsOf(secondDeck)
      expect(rec).toBeDefined()
      return rec!
    })
    const wav = await getStorage().get(recording.audioKey)
    expect(wav!.length).toBe(44 + 2 * FRAME)
  })
})
