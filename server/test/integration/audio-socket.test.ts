/**
 * Integration tests for the real-time STT WebSocket transport. A real ws
 * client connects to a real http.Server with attachAudioSocket wired up;
 * only Google's gRPC boundary (@google-cloud/speech) is mocked. Exercises
 * handshake auth and the audio-in → transcript-out relay end to end.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'

// Fake Google streaming duplex, exposed so tests can push recognition results.
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

const server = createApp().listen(0)
attachAudioSocket(server)
// The test env leaves TRANSCRIPTION_PROVIDER at its 'browser' default; point
// the active transcription adapter at the (mocked) Google one for this suite.
registry.register(
  'transcription',
  env.TRANSCRIPTION_PROVIDER,
  () => new GoogleCloudTranscriptionProvider(),
)

const port = (): number => (server.address() as AddressInfo).port
const url = (token?: string): string =>
  `ws://127.0.0.1:${port()}/api/stt${token ? `?token=${token}` : ''}`

afterAll(() => server.close())

/** Waits (briefly) until the mocked Google stream for a connection exists. */
const waitForStream = async (index: number): Promise<void> => {
  for (let i = 0; i < 50 && streams.length <= index; i++)
    await new Promise(resolve => setTimeout(resolve, 5))
}

describe('STT audio socket', () => {
  it('rejects the handshake without a token', async () => {
    const ws = new WebSocket(url())
    const status = await new Promise<number | undefined>(resolve => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
      ws.on('error', () => resolve(undefined))
    })
    expect(status).toBe(401)
  })

  it('rejects the handshake with an invalid token', async () => {
    const ws = new WebSocket(url('not-a-jwt'))
    const status = await new Promise<number | undefined>(resolve => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
      ws.on('error', () => resolve(undefined))
    })
    expect(status).toBe(401)
  })

  it('relays interim and final transcripts to an authed client', async () => {
    const token = await signAccessToken('user-1')
    const ws = new WebSocket(url(token))
    const received: { type?: string; text?: string }[] = []
    ws.on('message', data => received.push(JSON.parse(data.toString())))

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    ws.send(JSON.stringify({ type: 'start', languageCode: 'en-US' }))
    ws.send(new Uint8Array([1, 2, 3, 4]))

    await waitForStream(0)
    const stream = streams[0]!
    stream.emit('data', {
      results: [{ isFinal: false, alternatives: [{ transcript: 'hel' }] }],
    })
    stream.emit('data', {
      results: [
        {
          isFinal: true,
          alternatives: [{ transcript: 'hello', confidence: 0.9 }],
        },
      ],
    })

    // Let the async event drain reach the socket.
    await new Promise(resolve => setTimeout(resolve, 30))
    ws.close()

    expect(received).toContainEqual({ type: 'interim', text: 'hel' })
    // Finals now carry the phrase-level confidence (GEN-4 groundwork).
    expect(received).toContainEqual({
      type: 'final',
      text: 'hello',
      confidence: 0.9,
    })
  })

  it('forwards word timings and confidence on final transcripts', async () => {
    const token = await signAccessToken('user-2')
    const ws = new WebSocket(url(token))
    const received: {
      type?: string
      text?: string
      confidence?: number
      words?: unknown
    }[] = []
    ws.on('message', data => received.push(JSON.parse(data.toString())))

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    const index = streams.length
    ws.send(JSON.stringify({ type: 'start', languageCode: 'en-US' }))
    ws.send(new Uint8Array([1, 2, 3, 4]))

    await waitForStream(index)
    // Google-shaped final with word Durations; the real adapter converts them
    // to session-absolute ms and the relay forwards them verbatim.
    streams[index]!.emit('data', {
      results: [
        {
          isFinal: true,
          alternatives: [
            {
              transcript: 'hello world',
              confidence: 0.8,
              words: [
                {
                  word: 'hello',
                  startTime: { seconds: 0, nanos: 0 },
                  endTime: { seconds: 0, nanos: 500_000_000 },
                  confidence: 0.9,
                },
                {
                  word: 'world',
                  startTime: { seconds: 0, nanos: 500_000_000 },
                  endTime: { seconds: 1, nanos: 0 },
                  confidence: 0.7,
                },
              ],
            },
          ],
        },
      ],
    })

    await new Promise(resolve => setTimeout(resolve, 30))
    ws.close()

    expect(received).toContainEqual({
      type: 'final',
      text: 'hello world',
      confidence: 0.8,
      words: [
        { word: 'hello', startMs: 0, endMs: 500, confidence: 0.9 },
        { word: 'world', startMs: 500, endMs: 1000, confidence: 0.7 },
      ],
    })
  })
})
