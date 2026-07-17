/**
 * Unit tests for the Google Cloud STT streaming adapter against a stubbed
 * @google-cloud/speech client: config mapping, audio write-through, event
 * adaptation (interim/final/confidence), stream teardown, and the ~5-min
 * stream-cycle restart. The live gRPC API is never called from tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoisted so the vi.mock factory (which is lifted to the top of the file) can
// reference the fake client without a temporal-dead-zone error.
const { streams, streamingRecognize, SpeechClient } = vi.hoisted(() => {
  /** A controllable stand-in for Google's streamingRecognize duplex. The
   * config is captured from the constructor argument (the library sends it
   * itself); writes are the raw audio chunks. */
  class FakeRecognizeStream {
    config: unknown
    written: unknown[] = []
    ended = false
    private handlers: Record<string, ((arg: unknown) => void)[]> = {}
    constructor(config: unknown) {
      this.config = config
    }
    write(chunk: unknown): void {
      this.written.push(chunk)
    }
    end(): void {
      this.ended = true
    }
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
  const streamingRecognize = vi.fn((config: unknown) => {
    const stream = new FakeRecognizeStream(config)
    streams.push(stream)
    return stream
  })
  // Regular function (not arrow) so the adapter can `new SpeechClient()`.
  const SpeechClient = vi.fn(function () {
    return { streamingRecognize }
  })
  return { streams, streamingRecognize, SpeechClient }
})
vi.mock('@google-cloud/speech', () => ({ SpeechClient }))

import { GoogleCloudTranscriptionProvider } from './google-cloud-transcription'

/** Builds a Google-shaped result response. */
const dataEvent = (transcript: string, isFinal: boolean, confidence = 0) => ({
  results: [{ isFinal, alternatives: [{ transcript, confidence }] }],
})

beforeEach(() => {
  // Fake timers keep the 240s restart timer from dangling past each test.
  vi.useFakeTimers()
  streams.length = 0
  streamingRecognize.mockClear()
  SpeechClient.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GoogleCloudTranscriptionProvider', () => {
  it('opens the stream with the requested recognition config', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({
      languageCode: 'fr-FR',
      sampleRateHertz: 44_100,
      phraseHints: ['photosynthesis'],
    })
    // The config is the streamingRecognize() argument; the library sends it.
    expect(streams[0]!.config).toEqual({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 44_100,
        languageCode: 'fr-FR',
        speechContexts: [{ phrases: ['photosynthesis'] }],
      },
      interimResults: true,
    })
  })

  it('maps a bare locale to a region-qualified BCP-47 code for Google', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en' })
    const request = streams[0]!.config as {
      config: { languageCode: string }
    }
    // 'en' alone is rejected by Google STT; the adapter qualifies it.
    expect(request.config.languageCode).toBe('en-US')
  })

  it('defaults to 16 kHz and omits speechContexts without hints', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en-US' })
    const request = streams[0]!.config as {
      config: { sampleRateHertz: number; speechContexts?: unknown }
    }
    expect(request.config.sampleRateHertz).toBe(16_000)
    expect(request.config.speechContexts).toBeUndefined()
  })

  it('forwards raw audio chunks to the stream', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const chunk = new Uint8Array([1, 2, 3])
    stream.write(chunk)
    // Raw bytes — the client library wraps them as audioContent itself.
    expect(streams[0]!.written[0]).toBe(chunk)
  })

  it('adapts interim and final results into transcription events', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()

    streams[0]!.emit('data', dataEvent('hello wor', false))
    expect(await iterator.next()).toEqual({
      value: { text: 'hello wor', isFinal: false, confidence: 0 },
      done: false,
    })

    streams[0]!.emit('data', dataEvent('hello world', true, 0.95))
    expect(await iterator.next()).toEqual({
      value: { text: 'hello world', isFinal: true, confidence: 0.95 },
      done: false,
    })
  })

  it('ignores results with no transcript', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()

    streams[0]!.emit('data', { results: [] })
    streams[0]!.emit('data', dataEvent('kept', true))
    expect((await iterator.next()).value).toEqual({
      text: 'kept',
      isFinal: true,
      confidence: 0,
    })
  })

  it('ends the underlying stream and completes the iterable', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()
    stream.end()
    expect(streams[0]!.ended).toBe(true)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('cycles to a fresh stream when Google reports the duration limit', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    expect(streams).toHaveLength(1)
    // gRPC OUT_OF_RANGE (11) = max stream duration exceeded.
    streams[0]!.emit('error', { code: 11 })
    expect(streams).toHaveLength(2)
    expect(streams[0]!.ended).toBe(true)
    expect(streams[1]!.config).toMatchObject({ interimResults: true })
    stream.end() // clear the restart timer on the live stream
  })

  it('restarts before Google times the stream out', () => {
    vi.useFakeTimers()
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    expect(streams).toHaveLength(1)
    vi.advanceTimersByTime(240_000)
    expect(streams).toHaveLength(2)
    expect(streams[0]!.ended).toBe(true)
    stream.end()
  })

  it('constructs the SpeechClient only once, lazily', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    expect(SpeechClient).not.toHaveBeenCalled()
    provider.startStream({ languageCode: 'en-US' })
    provider.startStream({ languageCode: 'en-US' })
    expect(SpeechClient).toHaveBeenCalledTimes(1)
  })
})
