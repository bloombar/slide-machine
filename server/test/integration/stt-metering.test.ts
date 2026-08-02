/**
 * Integration tests for cloud-transcription metering (BILL-3) over the real
 * STT WebSocket. Only Google's gRPC boundary is mocked.
 *
 * The socket is the one metered path that cannot use an action's `meter` hook:
 * it never passes through `dispatch`, and a WebSocket has no response to carry
 * a 402. So it checks before opening a stream, settles periodically while one
 * runs, and stops the session when the allowance runs out.
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
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'

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

import { createApp } from '../../src/app'
import { attachAudioSocket } from '../../src/ws/audio-socket'
import { registry } from '../../src/providers/registry'
import { GoogleCloudTranscriptionProvider } from '../../src/providers/google-cloud-transcription'
import { env } from '../../src/config/env'
import { signAccessToken } from '../../src/auth/tokens'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { UsageRecordModel } from '../../src/models/usage-record'
import { recordUsage, usedThisPeriod, capFor } from '../../src/billing/usage'

const server = createApp().listen(0)
attachAudioSocket(server)
registry.register(
  'transcription',
  env.TRANSCRIPTION_PROVIDER,
  () => new GoogleCloudTranscriptionProvider(),
)

const port = (): number => (server.address() as AddressInfo).port
const url = (token: string): string =>
  `ws://127.0.0.1:${port()}/api/stt?token=${token}`

/** 16-bit mono PCM: one second of audio at the declared rate. */
const SAMPLE_RATE = 16_000
const oneSecond = new Uint8Array(SAMPLE_RATE * 2)

const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))

let userId: string
let token: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), UsageRecordModel.init()])
})

afterAll(async () => {
  server.close()
  await disconnectMongo()
})

beforeEach(async () => {
  streams.length = 0
  await Promise.all([UserModel.deleteMany({}), UsageRecordModel.deleteMany({})])
  // Pro by default: Free and Fresh have sttMinutes: 0 — browser capture only
  // — so a free user has no cloud transcription to meter in the first place.
  const user = await UserModel.create({
    email: 'ada@example.com',
    displayName: 'Ada',
    planTier: 'pro',
  })
  userId = user._id.toString()
  token = await signAccessToken(userId)
})

/** Opens a session and streams `seconds` of audio to the recognizer. */
const stream = async (seconds: number): Promise<WebSocket> => {
  const ws = new WebSocket(url(token))
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  ws.send(JSON.stringify({ type: 'start', sampleRate: SAMPLE_RATE }))
  await settle(20)
  for (let i = 0; i < seconds; i++) ws.send(oneSecond)
  return ws
}

describe('cloud transcription metering', () => {
  it('meters the audio it forwarded when the session ends', async () => {
    const ws = await stream(45)
    await settle()
    ws.close()
    await settle()

    // 45 seconds of audio, counted in minutes.
    expect(await usedThisPeriod(userId, 'sttMinutes')).toBeCloseTo(0.75, 2)
  })

  it('settles while a long session is still running', async () => {
    // Past the 30-second settle interval, so the counter moves before close.
    const ws = await stream(31)
    await settle()

    expect(await usedThisPeriod(userId, 'sttMinutes')).toBeGreaterThan(0)
    ws.close()
    await settle()
  })

  it('refuses to open a stream when the allowance is already spent', async () => {
    await recordUsage(userId, 'sttMinutes', capFor('pro', 'sttMinutes')! + 1)

    const ws = new WebSocket(url(token))
    const messages: { type?: string; message?: string }[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    await new Promise<void>(resolve => ws.on('open', () => resolve()))
    ws.send(JSON.stringify({ type: 'start', sampleRate: SAMPLE_RATE }))
    await settle()

    expect(messages).toContainEqual({
      type: 'error',
      message:
        'You have used all of this billing period’s cloud transcription.',
    })
    // Nothing was sent to the recognizer, so nothing was billed.
    expect(streams).toHaveLength(0)
  })

  it('gives every tier a positive allowance, enforced the same way', async () => {
    // The engine is a deployment-wide choice, so a free user records through
    // the same recognizer a Pro user does — they just get fewer minutes.
    await UserModel.updateOne({ _id: userId }, { planTier: 'free' })
    expect(capFor('free', 'sttMinutes')).toBeGreaterThan(0)
    await recordUsage(userId, 'sttMinutes', capFor('free', 'sttMinutes')! + 1)

    const ws = new WebSocket(url(token))
    const messages: { type?: string }[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    await new Promise<void>(resolve => ws.on('open', () => resolve()))
    ws.send(JSON.stringify({ type: 'start', sampleRate: SAMPLE_RATE }))
    await settle()

    expect(messages.some(m => m.type === 'error')).toBe(true)
    expect(streams).toHaveLength(0)
  })

  it('warns once before the allowance runs out, not only at the wall', async () => {
    // Just past 80% of Free's 90 minutes, with room left to finish a thought.
    await UserModel.updateOne({ _id: userId }, { planTier: 'free' })
    const cap = capFor('free', 'sttMinutes')!
    await recordUsage(userId, 'sttMinutes', cap * 0.81)

    const ws = await stream(31)
    const messages: { type?: string; message?: string }[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    await settle(120)

    const warnings = messages.filter(m => m.type === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toMatch(/used most of/i)
    // Still recording: a warning is not a stop.
    expect(await usedThisPeriod(userId, 'sttMinutes')).toBeLessThan(cap)
    ws.close()
    await settle()
  })

  it('stops a running session once the allowance runs out mid-lecture', async () => {
    // A fraction of a minute short of the cap, then stream past it.
    await recordUsage(userId, 'sttMinutes', capFor('pro', 'sttMinutes')! - 0.1)
    const ws = await stream(31)
    const messages: { type?: string; message?: string }[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    await settle(120)

    expect(messages.some(m => m.type === 'error')).toBe(true)
    // The overrun is bounded by the settle interval, not by the lecture.
    expect(await usedThisPeriod(userId, 'sttMinutes')).toBeLessThan(
      capFor('pro', 'sttMinutes')! + 1,
    )
  })
})
