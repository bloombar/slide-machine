/**
 * Integration tests for the audio socket's session-telemetry writes (SPEC
 * EVAL-1) over the real STT WebSocket: lifecycle rows, finalization samples,
 * restart/error rows, end classification, and the deck ownership guard.
 * Google's gRPC boundary is mocked; MongoDB is real.
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

// Mock Google's streaming duplex (no real gRPC), emit-capable so tests can
// drive finals, restarts and hard errors through the real adapter.
const { streams, SpeechClient } = vi.hoisted(() => {
  class FakeRecognizeStream {
    private handlers: Record<string, ((arg: unknown) => void)[]> = {}
    write(): void {}
    end(): void {}
    destroy(): void {}
    on(event: string, handler: (arg: unknown) => void): this {
      ;(this.handlers[event] ??= []).push(handler)
      return this
    }
    emit(event: string, arg?: unknown): void {
      ;(this.handlers[event] ?? []).forEach(handler => handler(arg))
    }
  }
  const streams: FakeRecognizeStream[] = []
  const SpeechClient = vi.fn(function () {
    return {
      streamingRecognize: () => {
        const stream = new FakeRecognizeStream()
        streams.push(stream)
        return stream
      },
    }
  })
  return { streams, SpeechClient }
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
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { SessionTelemetryEventModel } from '../../src/models/session-telemetry-event'

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

const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms))

/** 16-bit mono PCM: one second of audio at the declared rate. */
const SAMPLE_RATE = 16_000
const oneSecond = new Uint8Array(SAMPLE_RATE * 2)

/** A Google-shaped final with one word ending at `endSec`. */
const finalAt = (endSec: number) => ({
  results: [
    {
      isFinal: true,
      alternatives: [
        {
          transcript: 'hello world',
          confidence: 0.9,
          words: [
            {
              word: 'hello',
              startTime: { seconds: 0, nanos: 0 },
              endTime: {
                seconds: Math.floor(endSec),
                nanos: (endSec % 1) * 1e9,
              },
              confidence: 0.9,
            },
          ],
        },
      ],
    },
  ],
})

const openSocket = async (token: string): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/stt?token=${token}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  return ws
}

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
  streams.length = 0
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    SessionTelemetryEventModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
  })
  deckId = deck.body.id
})

describe('session telemetry over the audio socket', () => {
  it('writes session_start with the deck when the user may edit it', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-start',
        deckId,
        languageCode: 'en-US',
      }),
    )
    await settle()
    ws.close()
    await settle()

    const rows = await rowsFor('sess-start')
    expect(rows[0]).toMatchObject({
      kind: 'session_start',
      languageCode: 'en-US',
      sampleRate: SAMPLE_RATE,
    })
    expect(rows[0]!.deckId?.toString()).toBe(deckId)
  })

  it('keys rows to no deck when the user cannot edit the one named', async () => {
    const bob = await registerUser('bob@example.com')
    const project = await act(bob, 'project.create', { title: 'Not yours' })
    const bobsDeck = await act(bob, 'deck.create', {
      projectId: project.body.id,
      title: 'Private',
    })

    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-foreign',
        deckId: bobsDeck.body.id,
      }),
    )
    await settle()
    ws.close()
    await settle()

    const rows = await rowsFor('sess-foreign')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.deckId).toBeNull()
  })

  it('records finalization latency and audio offset on finals', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-final',
        deckId,
      }),
    )
    await settle(50)
    ws.send(oneSecond)
    await settle(50)
    streams[0]!.emit('data', finalAt(0.5))
    await settle()
    ws.close()
    await settle()

    const rows = await rowsFor('sess-final')
    const final = rows.find(r => r.kind === 'stt_final')
    expect(final).toBeDefined()
    expect(final!.audioMs).toBe(500)
    expect(final!.finalizationMs).toBeGreaterThanOrEqual(0)
  })

  it('records a restart row when the stream cycles on OUT_OF_RANGE', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-restart',
        deckId,
      }),
    )
    await settle(50)
    streams[0]!.emit('error', { code: 11 })
    await settle()
    ws.close()
    await settle()

    const rows = await rowsFor('sess-restart')
    expect(
      rows.some(
        r => r.kind === 'stt_restart' && r.restartReason === 'out_of_range',
      ),
    ).toBe(true)
  })

  it('records a hard stream error and an abandoned end', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-error',
        deckId,
      }),
    )
    await settle(50)
    streams[0]!.emit('error', { code: 13, message: 'internal' })
    await settle()

    const rows = await rowsFor('sess-error')
    expect(rows.some(r => r.kind === 'stt_error')).toBe(true)
    const end = rows.find(r => r.kind === 'session_end')
    expect(end).toMatchObject({ endReason: 'abandoned' })
    ws.close()
  })

  it('classifies a deliberate stop and reports captured audio, once', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-stop',
        deckId,
      }),
    )
    await settle(50)
    for (let i = 0; i < 3; i++) ws.send(oneSecond)
    await settle(50)
    // The client's deliberate stop precedes the close it causes.
    ws.send(JSON.stringify({ type: 'stop' }))
    await settle(50)
    ws.close()
    await settle()

    const ends = (await rowsFor('sess-stop')).filter(
      r => r.kind === 'session_end',
    )
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ endReason: 'stopped' })
    // Three seconds of 16 kHz 16-bit mono.
    expect(ends[0]!.capturedMs).toBe(3_000)
  })

  it('classifies a close without a stop frame as abandoned', async () => {
    const ws = await openSocket(ada)
    ws.send(
      JSON.stringify({
        type: 'start',
        sampleRate: SAMPLE_RATE,
        sessionId: 'sess-abandon',
        deckId,
      }),
    )
    await settle(50)
    ws.close()
    await settle()

    const ends = (await rowsFor('sess-abandon')).filter(
      r => r.kind === 'session_end',
    )
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ endReason: 'abandoned' })
  })

  it('writes nothing for a session that never named a sessionId', async () => {
    const ws = await openSocket(ada)
    ws.send(JSON.stringify({ type: 'start', sampleRate: SAMPLE_RATE, deckId }))
    await settle(50)
    ws.send(oneSecond)
    await settle(50)
    ws.close()
    await settle()

    expect(await SessionTelemetryEventModel.countDocuments({})).toBe(0)
  })
})
