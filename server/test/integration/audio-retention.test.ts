/**
 * Integration test for lecture-audio retention (GEN-4 Phase 2). With
 * AUDIO_RETENTION_ENABLED on, streaming audio over the STT WebSocket for a
 * deck the user can edit persists a WAV to blob storage and records a
 * reference on the deck, keyed by the recording sessionId. Google's gRPC
 * boundary is mocked; MongoDB and local storage are real.
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
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'

// Feature flag on, with a dedicated storage dir so the test's audio is isolated.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      AUDIO_RETENTION_ENABLED: true,
      STORAGE_LOCAL_DIR: '.uploads-audio-test',
    },
  }
})

// Mock Google's streaming duplex (no real gRPC), like the audio-socket suite.
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
import { registry } from '../../src/providers/registry'
import { GoogleCloudTranscriptionProvider } from '../../src/providers/google-cloud-transcription'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import {
  adjustGauge,
  capFor,
  usedThisPeriod,
  STANDING_PERIOD,
} from '../../src/billing/usage'
import { getStorage } from '../../src/storage'

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

/** Opens the STT socket, sends the start message + one audio frame, closes. */
const streamAudio = async (
  token: string,
  start: object,
  audio: Uint8Array,
): Promise<void> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/stt?token=${token}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  ws.send(JSON.stringify(start))
  await new Promise(r => setTimeout(r, 20)) // let the provider stream start
  ws.send(audio)
  await new Promise(r => setTimeout(r, 20))
  ws.close()
}

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
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  projectId = project.body.id
})

describe('STT audio retention', () => {
  it('streams raw PCM to storage and records it on the deck for the owner', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture 1',
      templateId: 'classic',
    })
    const deckId = deck.body.id as string

    // 32000 bytes of LINEAR16 mono @ 16kHz = 1000 ms of audio.
    await streamAudio(
      ada,
      {
        type: 'start',
        languageCode: 'en-US',
        sampleRate: 16_000,
        deckId,
        sessionId: 'rec-1',
      },
      new Uint8Array(32_000),
    )

    // The recording lands asynchronously on socket close.
    const recording = await vi.waitFor(async () => {
      const doc = await DeckModel.findById(deckId)
      const rec = doc?.recordings?.[0]
      expect(rec).toBeDefined()
      return rec!
    })

    expect(recording.sessionId).toBe('rec-1')
    expect(recording.sampleRate).toBe(16_000)
    expect(recording.durationMs).toBe(1000)
    // `.pcm`, not `.wav`: a WAV header must state a total length that is
    // unknown until the lecture ends, so the container cannot be streamed.
    expect(recording.audioKey).toMatch(new RegExp(`^audio/${deckId}/.*\\.pcm$`))

    // The stored blob is exactly the payload — no header, nothing added.
    const stored = await getStorage().get(recording.audioKey)
    expect(stored).not.toBeNull()
    expect(stored!.length).toBe(32_000)
    expect(stored!.equals(Buffer.alloc(32_000))).toBe(true)
  })

  it('does not retain audio for a deck the user cannot edit', async () => {
    const bob = await registerUser('bob@example.com')
    const bobProject = await act(bob, 'project.create', { title: 'Bob' })
    const bobDeck = await act(bob, 'deck.create', {
      projectId: bobProject.body.id,
      title: 'Private',
      templateId: 'classic',
    })
    const bobDeckId = bobDeck.body.id as string

    // ada streams audio naming bob's deck — she can't edit it, so nothing sticks.
    await streamAudio(
      ada,
      {
        type: 'start',
        languageCode: 'en-US',
        sampleRate: 16_000,
        deckId: bobDeckId,
        sessionId: 'rec-x',
      },
      new Uint8Array(16_000),
    )

    await new Promise(r => setTimeout(r, 200)) // allow any (rejected) flush to run
    const doc = await DeckModel.findById(bobDeckId)
    expect(doc?.recordings ?? []).toHaveLength(0)

    // Stronger than "no deck reference": with audio streaming out as it
    // arrives, the edit check has to gate the FIRST byte. Nothing may reach
    // storage for a user who cannot edit the lecture — not even briefly.
    const dir = join(env.STORAGE_LOCAL_DIR, 'audio', bobDeckId)
    const written = await readdir(dir).catch(() => [] as string[])
    expect(written).toEqual([])
  })
})

/**
 * Retained audio is metered as a **stock** (BILL-3): what the owner is holding
 * right now, charged when the recording lands and given back when it is
 * deleted, never reset by a billing period.
 */
describe('STT audio retention metering', () => {
  const adaId = async () =>
    (await UserModel.findOne({ email: 'ada@example.com' }))!._id.toString()

  const streamOneSecond = async (deckId: string, sessionId = 'rec-1') =>
    streamAudio(
      ada,
      {
        type: 'start',
        languageCode: 'en-US',
        sampleRate: 16_000,
        deckId,
        sessionId,
      },
      new Uint8Array(32_000), // 1000 ms of LINEAR16 mono @ 16 kHz
    )

  const newDeck = async (): Promise<string> => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture',
      templateId: 'classic',
    })
    return deck.body.id as string
  }

  it('charges the stored megabytes to the deck owner', async () => {
    const deckId = await newDeck()

    await streamOneSecond(deckId)

    await vi.waitFor(async () => {
      const held = await usedThisPeriod(await adaId(), 'audioStorageMb')
      expect(held).toBeCloseTo(32_000 / (1024 * 1024), 6)
    })
  })

  it('accumulates across recordings instead of resetting', async () => {
    const deckId = await newDeck()

    await streamOneSecond(deckId, 'rec-1')
    await vi.waitFor(async () =>
      expect(
        await usedThisPeriod(await adaId(), 'audioStorageMb'),
      ).toBeGreaterThan(0),
    )
    await streamOneSecond(deckId, 'rec-2')

    await vi.waitFor(async () => {
      const held = await usedThisPeriod(await adaId(), 'audioStorageMb')
      expect(held).toBeCloseTo((2 * 32_000) / (1024 * 1024), 6)
    })
  })

  it('keeps the gauge under a period key that never rolls over', async () => {
    // A stock is not a per-period total: audio retained last month is still on
    // a disk this month, so the counter must not be filed under a period that
    // a subscription rollover would leave behind.
    const deckId = await newDeck()
    await streamOneSecond(deckId)

    const row = await vi.waitFor(async () => {
      const found = await UsageRecordModel.findOne({
        userId: await adaId(),
        metric: 'audioStorageMb',
      })
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.period).toBe(STANDING_PERIOD)
  })

  it('transcribes without retaining once the owner’s storage is full', async () => {
    // Degrades exactly as the process-wide memory budget does: the lecture is
    // still transcribed, the audio simply is not kept. There is no response to
    // carry a 402 on a WebSocket, and losing the transcript would be far worse
    // than losing a recording.
    const deckId = await newDeck()
    await adjustGauge(
      await adaId(),
      'audioStorageMb',
      capFor('free', 'audioStorageMb')!,
    )

    await streamOneSecond(deckId)
    await new Promise(r => setTimeout(r, 200)) // allow any flush to run

    const doc = await DeckModel.findById(deckId)
    expect(doc?.recordings ?? []).toHaveLength(0)
    const dir = join(env.STORAGE_LOCAL_DIR, 'audio', deckId)
    expect(await readdir(dir).catch(() => [] as string[])).toEqual([])
  })
})
