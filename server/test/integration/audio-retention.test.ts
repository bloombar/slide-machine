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
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  projectId = project.body.id
})

describe('STT audio retention', () => {
  it('stores a WAV and records it on the deck for the owner', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture 1',
      templateId: 'classic',
    })
    const deckId = deck.body.id as string

    // 32000 bytes of LINEAR16 mono @ 16kHz = 1000 ms of audio.
    await streamAudio(
      ada,
      { type: 'start', languageCode: 'en-US', sampleRate: 16_000, deckId, sessionId: 'rec-1' },
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
    expect(recording.audioKey).toMatch(new RegExp(`^audio/${deckId}/`))

    // The stored blob is a real WAV wrapping the 32000-byte payload.
    const wav = await getStorage().get(recording.audioKey)
    expect(wav).not.toBeNull()
    expect(wav!.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav!.length).toBe(44 + 32_000)
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
      { type: 'start', languageCode: 'en-US', sampleRate: 16_000, deckId: bobDeckId, sessionId: 'rec-x' },
      new Uint8Array(16_000),
    )

    await new Promise(r => setTimeout(r, 100)) // allow any (rejected) flush to run
    const doc = await DeckModel.findById(bobDeckId)
    expect(doc?.recordings ?? []).toHaveLength(0)
  })
})
