/**
 * Unit tests for one-shot transcription of a finished clip: the audio reaches
 * the engine in full, only final phrases are kept (in order), and the keyless
 * engines report themselves unavailable. The provider is a stub — no engine and
 * no audio are involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  TranscriptionEvent,
  TranscriptionStreamOptions,
} from '@slide-machine/shared'
import { AsyncQueue } from '../providers/async-queue'

// The active adapter name comes from config; a mutable stub lets each test pick
// the engine without touching the process env.
const mockEnv = vi.hoisted(() => ({ env: { TRANSCRIPTION_PROVIDER: 'mock' } }))
vi.mock('../config/env', () => mockEnv)

/** A stub engine that records what it was given and emits scripted events. */
const stubProvider = (script: TranscriptionEvent[] = []) => {
  const writes: Buffer[] = []
  let options: TranscriptionStreamOptions | undefined
  let ended = false
  const provider = {
    name: 'stub',
    startStream(opts: TranscriptionStreamOptions) {
      options = opts
      const events = new AsyncQueue<TranscriptionEvent>()
      return {
        write(chunk: Uint8Array) {
          writes.push(Buffer.from(chunk))
        },
        end() {
          ended = true
          // Like a real engine, the last results land as the stream closes.
          for (const event of script) events.push(event)
          events.close()
        },
        events,
      }
    },
  }
  return {
    provider,
    writes,
    options: () => options,
    ended: () => ended,
    written: () => Buffer.concat(writes),
  }
}

const final = (text: string): TranscriptionEvent => ({
  text,
  isFinal: true,
  confidence: 1,
})

const get = vi.fn()
vi.mock('../providers/registry', () => ({ registry: { get: () => get() } }))

beforeEach(() => {
  mockEnv.env.TRANSCRIPTION_PROVIDER = 'mock'
  get.mockReset()
})

describe('serverTranscriptionAvailable', () => {
  it('is false for the keyless engines, which only run in the browser', async () => {
    const { serverTranscriptionAvailable } = await import('./transcribe-audio')
    for (const provider of ['browser', 'none']) {
      mockEnv.env.TRANSCRIPTION_PROVIDER = provider
      expect(serverTranscriptionAvailable()).toBe(false)
    }
  })

  it('is true for a server-side adapter', async () => {
    const { serverTranscriptionAvailable } = await import('./transcribe-audio')
    mockEnv.env.TRANSCRIPTION_PROVIDER = 'google-cloud'
    expect(serverTranscriptionAvailable()).toBe(true)
  })
})

describe('transcribeAudio', () => {
  it('joins the final phrases in the order they were heard', async () => {
    const { transcribeAudio } = await import('./transcribe-audio')
    const stub = stubProvider([
      final('Plants convert light'),
      { text: 'into', isFinal: false, confidence: 0 },
      final('into sugar'),
    ])
    get.mockReturnValue(stub.provider)

    const transcript = await transcribeAudio({
      pcm: Buffer.alloc(64),
      sampleRate: 16_000,
      languageCode: 'en',
    })
    // Interim results are working guesses, never part of the transcript.
    expect(transcript).toBe('Plants convert light into sugar')
    expect(stub.ended()).toBe(true)
  })

  it('feeds the whole clip to the engine, chunked, at its capture rate', async () => {
    const { transcribeAudio } = await import('./transcribe-audio')
    const stub = stubProvider([final('ok')])
    get.mockReturnValue(stub.provider)

    // Larger than one 32 KB chunk, so the chunking is exercised.
    const pcm = Buffer.alloc(80 * 1024, 7)
    await transcribeAudio({
      pcm,
      sampleRate: 44_100,
      languageCode: 'fr',
      phraseHints: ['photosynthèse'],
    })

    expect(stub.writes.length).toBeGreaterThan(1)
    expect(stub.written().equals(pcm)).toBe(true)
    expect(stub.options()).toEqual({
      languageCode: 'fr',
      sampleRateHertz: 44_100,
      phraseHints: ['photosynthèse'],
    })
  })

  it('returns empty text when the engine heard nothing', async () => {
    const { transcribeAudio } = await import('./transcribe-audio')
    const stub = stubProvider([])
    get.mockReturnValue(stub.provider)
    expect(
      await transcribeAudio({
        pcm: Buffer.alloc(16),
        sampleRate: 16_000,
        languageCode: 'en',
      }),
    ).toBe('')
  })

  it('closes the stream even when writing fails', async () => {
    const { transcribeAudio } = await import('./transcribe-audio')
    const stub = stubProvider([])
    get.mockReturnValue({
      ...stub.provider,
      startStream: (opts: TranscriptionStreamOptions) => {
        const stream = stub.provider.startStream(opts)
        return {
          ...stream,
          write() {
            throw new Error('engine went away')
          },
        }
      },
    })

    await expect(
      transcribeAudio({
        pcm: Buffer.alloc(16),
        sampleRate: 16_000,
        languageCode: 'en',
      }),
    ).rejects.toThrow('engine went away')
    // Left open, the engine's session would leak for the rest of the process.
    expect(stub.ended()).toBe(true)
  })
})
