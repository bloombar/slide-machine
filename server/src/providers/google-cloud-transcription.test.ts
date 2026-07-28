/**
 * Unit tests for the Google Cloud STT streaming adapter against a stubbed
 * @google-cloud/speech client: config mapping, audio write-through, event
 * adaptation (interim/final/confidence), stream teardown, and the ~5-min
 * stream-cycle restart. The live gRPC API is never called from tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoisted so the vi.mock factory (which is lifted to the top of the file) can
// reference the fake client without a temporal-dead-zone error.
const { streams, streamingRecognize, getAccessToken, close, SpeechClient } =
  vi.hoisted(() => {
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
    // Auth stub for the health probe: getAccessToken succeeds by default;
    // tests override it to exercise the down path.
    const getAccessToken = vi.fn(async () => 'token')
    const close = vi.fn(async () => {})
    // Regular function (not arrow) so the adapter can `new SpeechClient()`.
    const SpeechClient = vi.fn(function () {
      return { streamingRecognize, auth: { getAccessToken }, close }
    })
    return { streams, streamingRecognize, getAccessToken, close, SpeechClient }
  })
vi.mock('@google-cloud/speech', () => ({ SpeechClient }))

// The provider reads the credential vars and the active provider name from
// env; a mutable stub lets each test pick the auth path and STT engine.
const mockEnv = vi.hoisted(() => ({
  env: {
    TRANSCRIPTION_PROVIDER: 'google-cloud' as string,
    GOOGLE_APPLICATION_CREDENTIALS: undefined as string | undefined,
    GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined as string | undefined,
  },
}))
vi.mock('../config/env', () => mockEnv)

// Stub the key-file read so the file-path branch needs no real file on disk.
const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync }))

import {
  GoogleCloudTranscriptionProvider,
  pingGoogleStt,
} from './google-cloud-transcription'

/** A single word for {@link dataEvent}, in seconds (the adapter converts to ms). */
interface TestWord {
  word: string
  startSec: number
  endSec: number
  confidence?: number
}

/** Converts fractional seconds to a protobuf Duration as Google returns it. */
const googleDuration = (seconds: number) => ({
  seconds: Math.floor(seconds),
  nanos: Math.round((seconds - Math.floor(seconds)) * 1e9),
})

/** Builds a Google-shaped result response, optionally with word timings. */
const dataEvent = (
  transcript: string,
  isFinal: boolean,
  confidence = 0,
  words?: TestWord[],
) => ({
  results: [
    {
      isFinal,
      alternatives: [
        {
          transcript,
          confidence,
          ...(words
            ? {
                words: words.map(w => ({
                  word: w.word,
                  startTime: googleDuration(w.startSec),
                  endTime: googleDuration(w.endSec),
                  confidence: w.confidence,
                })),
              }
            : {}),
        },
      ],
    },
  ],
})

beforeEach(() => {
  // Fake timers keep the 240s restart timer from dangling past each test.
  vi.useFakeTimers()
  streams.length = 0
  streamingRecognize.mockClear()
  SpeechClient.mockClear()
  getAccessToken.mockClear()
  getAccessToken.mockResolvedValue('token')
  close.mockClear()
  readFileSync.mockReset()
  mockEnv.env.TRANSCRIPTION_PROVIDER = 'google-cloud'
  mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS = undefined
  mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = undefined
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
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        speechContexts: [{ phrases: ['photosynthesis'] }],
      },
      interimResults: true,
    })
  })

  it('requests word time offsets and per-word confidence', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en-US' })
    const request = streams[0]!.config as {
      config: {
        enableWordTimeOffsets?: boolean
        enableWordConfidence?: boolean
      }
    }
    // These drive the GEN-4 diarization time-join.
    expect(request.config.enableWordTimeOffsets).toBe(true)
    expect(request.config.enableWordConfidence).toBe(true)
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

  it('attaches session-absolute word timings to final results', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({
      languageCode: 'en-US',
      sampleRateHertz: 16_000,
    })
    const iterator = stream.events[Symbol.asyncIterator]()

    streams[0]!.emit(
      'data',
      dataEvent('hello world', true, 0.9, [
        { word: 'hello', startSec: 0, endSec: 0.5, confidence: 0.9 },
        { word: 'world', startSec: 0.5, endSec: 1, confidence: 0.8 },
      ]),
    )
    expect((await iterator.next()).value).toEqual({
      text: 'hello world',
      isFinal: true,
      confidence: 0.9,
      words: [
        { word: 'hello', startMs: 0, endMs: 500, confidence: 0.9 },
        { word: 'world', startMs: 500, endMs: 1000, confidence: 0.8 },
      ],
    })
    stream.end()
  })

  it('omits word timings on interim results', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()

    // Even if the payload carried words, interim timings are volatile — dropped.
    streams[0]!.emit(
      'data',
      dataEvent('hello', false, 0, [
        { word: 'hello', startSec: 0, endSec: 0.3 },
      ]),
    )
    expect((await iterator.next()).value).toEqual({
      text: 'hello',
      isFinal: false,
      confidence: 0,
    })
    stream.end()
  })

  it('keeps word offsets session-absolute across a stream restart', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({
      languageCode: 'en-US',
      sampleRateHertz: 16_000,
    })
    const iterator = stream.events[Symbol.asyncIterator]()

    // 16000 bytes = 8000 samples at 16 kHz mono (2 bytes/sample) = 500 ms.
    stream.write(new Uint8Array(16_000))
    // Google reports the duration limit → the adapter cycles to a fresh stream.
    streams[0]!.emit('error', { code: 11 })
    expect(streams).toHaveLength(2)

    // A word at 200 ms on the NEW stream is really 500 + 200 = 700 ms in.
    streams[1]!.emit(
      'data',
      dataEvent('later', true, 0, [
        { word: 'later', startSec: 0.2, endSec: 0.4, confidence: 1 },
      ]),
    )
    expect((await iterator.next()).value).toEqual({
      text: 'later',
      isFinal: true,
      confidence: 0,
      words: [{ word: 'later', startMs: 700, endMs: 900, confidence: 1 }],
    })
    stream.end()
  })

  it('ends the underlying stream and completes when Google closes it', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()
    stream.end()
    expect(streams[0]!.ended).toBe(true)

    // Google delivers the finals for trailing audio only after the request
    // stream is half-closed, so the iterable stays open until it says so.
    streams[0]!.emit('data', dataEvent('the last words', true))
    expect((await iterator.next()).value).toMatchObject({
      text: 'the last words',
      isFinal: true,
    })
    streams[0]!.emit('end')
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('completes anyway when a closed stream never ends', async () => {
    vi.useFakeTimers()
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()
    stream.end()
    // No 'end' from Google — the grace window is the backstop, so a consumer
    // is never left waiting forever.
    vi.advanceTimersByTime(15_000)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('completes when a closed stream errors instead of ending', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()
    stream.end()
    streams[0]!.emit('error', { code: 13 })
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('keeps the iterable open when a retired stream ends after a restart', async () => {
    const provider = new GoogleCloudTranscriptionProvider()
    const stream = provider.startStream({ languageCode: 'en-US' })
    const iterator = stream.events[Symbol.asyncIterator]()
    // Cycle to a fresh stream, then end: the retired stream closing must not
    // cut off the live one's remaining results.
    streams[0]!.emit('error', { code: 11 })
    stream.end()
    streams[0]!.emit('end')
    streams[1]!.emit('data', dataEvent('still listening', true))
    expect((await iterator.next()).value).toMatchObject({
      text: 'still listening',
    })
    streams[1]!.emit('end')
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

  it('passes inline JSON credentials in memory, never a key file', () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      project_id: 'slide-machine',
      client_email: 'stt@slide-machine.iam.gserviceaccount.com',
      private_key: 'KEY',
    })
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en-US' })
    // In-memory credentials mean the library never reads a file (the source
    // of the ENOENT crash); projectId is lifted from the key.
    expect(SpeechClient).toHaveBeenCalledWith({
      credentials: {
        project_id: 'slide-machine',
        client_email: 'stt@slide-machine.iam.gserviceaccount.com',
        private_key: 'KEY',
      },
      projectId: 'slide-machine',
    })
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it('reads the key file itself and passes its contents as credentials', () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS = '/secrets/key.json'
    readFileSync.mockReturnValue(
      JSON.stringify({ project_id: 'p', client_email: 'e', private_key: 'k' }),
    )
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en-US' })
    expect(readFileSync).toHaveBeenCalledWith('/secrets/key.json', 'utf8')
    expect(SpeechClient).toHaveBeenCalledWith({
      credentials: { project_id: 'p', client_email: 'e', private_key: 'k' },
      projectId: 'p',
    })
  })

  it('falls back to ambient credentials when neither var is set', () => {
    const provider = new GoogleCloudTranscriptionProvider()
    provider.startStream({ languageCode: 'en-US' })
    expect(SpeechClient).toHaveBeenCalledWith({})
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it('throws a clear, catchable error on malformed credentials JSON', () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{not json'
    const provider = new GoogleCloudTranscriptionProvider()
    // Synchronous throw (not an async rejection) so the socket layer can catch
    // it and fail one connection instead of crashing the process.
    expect(() => provider.startStream({ languageCode: 'en-US' })).toThrow(
      /not valid JSON/,
    )
  })

  it('surfaces a missing key file as a synchronous throw', () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS = '/secrets/missing.json'
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const provider = new GoogleCloudTranscriptionProvider()
    expect(() => provider.startStream({ languageCode: 'en-US' })).toThrow(
      /ENOENT/,
    )
  })
})

describe('pingGoogleStt', () => {
  it('reports disabled when the browser engine is active', async () => {
    mockEnv.env.TRANSCRIPTION_PROVIDER = 'browser'
    expect(await pingGoogleStt()).toEqual({
      status: 'disabled',
      detail: 'browser (client-side)',
    })
    expect(SpeechClient).not.toHaveBeenCalled()
  })

  it('reports disabled for a non-Google server engine', async () => {
    mockEnv.env.TRANSCRIPTION_PROVIDER = 'mock'
    expect(await pingGoogleStt()).toEqual({
      status: 'disabled',
      detail: 'mock',
    })
  })

  it('reports down when google-cloud is active but has no credentials', async () => {
    mockEnv.env.TRANSCRIPTION_PROVIDER = 'google-cloud'
    expect(await pingGoogleStt()).toEqual({
      status: 'down',
      detail: 'no credentials',
    })
    expect(SpeechClient).not.toHaveBeenCalled()
  })

  it('reports ok when the service account yields an access token', async () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      project_id: 'p',
    })
    expect(await pingGoogleStt()).toEqual({ status: 'ok', detail: 'connected' })
    expect(getAccessToken).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('reports down when fetching an access token fails', async () => {
    mockEnv.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      project_id: 'p',
    })
    getAccessToken.mockRejectedValue(new Error('invalid_grant'))
    expect((await pingGoogleStt()).status).toBe('down')
    expect(close).toHaveBeenCalled()
  })
})
