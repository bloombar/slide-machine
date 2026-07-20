/**
 * Google Cloud Speech-to-Text streaming adapter (SPEC CAP-3 / TECH-8).
 * Relays PCM audio to Google's `streamingRecognize` gRPC stream and adapts
 * its results to the capability-neutral TranscriptionProvider interface, so
 * the WebSocket transport and the client stay engine-agnostic.
 *
 * Real-time streaming needs a service-account credential (an API key is
 * rejected by the streaming endpoint): a key file via
 * GOOGLE_APPLICATION_CREDENTIALS (local dev) or the key JSON supplied inline
 * via GOOGLE_APPLICATION_CREDENTIALS_JSON (deployed). See docs/GOOGLE_API_KEYS.md.
 */
import { readFileSync } from 'node:fs'
import { SpeechClient } from '@google-cloud/speech'
import type {
  HealthComponent,
  TranscriptionEvent,
  TranscriptionProvider,
  TranscriptionStream,
  TranscriptionStreamOptions,
  WordTiming,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { AsyncQueue } from './async-queue'

/**
 * SpeechClient auth options, resolved from config. We load the service
 * account into memory ourselves — inline JSON preferred, else read the key
 * file synchronously — and hand the client `credentials` rather than a
 * `keyFilename`. That way the library never reads a file during a live gRPC
 * call, so a missing or malformed key surfaces here as a synchronous, catchable
 * error instead of an unhandled promise rejection that crashes the process.
 * With neither var set we return {} so ambient credentials still work.
 */
const speechClientOptions = (): ConstructorParameters<
  typeof SpeechClient
>[0] => {
  const raw =
    env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    (env.GOOGLE_APPLICATION_CREDENTIALS
      ? readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
      : null)
  if (!raw) return {}
  let credentials: { project_id?: string }
  try {
    credentials = JSON.parse(raw)
  } catch {
    throw new Error('Google service-account credentials are not valid JSON')
  }
  return { credentials, projectId: credentials.project_id }
}

/** Google caps one streaming session at ~305s; restart well before that and
 * on the limit error so long lectures transcribe without interruption. */
const STREAM_RESTART_MS = 240_000
/** gRPC status code Google returns when a stream outlives its max duration. */
const OUT_OF_RANGE = 11

/** Google STT needs a region-qualified BCP-47 tag; the app's Locale codes
 * (shared/types/locale) are bare language subtags, so map them. Unknown or
 * already-qualified values (e.g. 'en-GB') pass through untouched. */
const BCP47_BY_LOCALE: Record<string, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  zh: 'cmn-Hans-CN',
}
const toBcp47 = (languageCode: string): string =>
  BCP47_BY_LOCALE[languageCode] ?? languageCode

/** Minimal shape of the duplex returned by `client.streamingRecognize()`. */
interface RecognizeStream {
  write(request: unknown): void
  end(): void
  destroy(): void
  on(event: 'data', handler: (response: unknown) => void): void
  on(event: 'error', handler: (error: { code?: number }) => void): void
}

/** A protobuf Duration as the client library surfaces it: `seconds` may be a
 * number, a string, or a Long-like object depending on the value's size. */
interface GoogleDuration {
  seconds?: number | string
  nanos?: number
}

/** Converts a Google Duration to milliseconds, tolerating string seconds. */
const durationToMs = (d?: GoogleDuration): number => {
  if (!d) return 0
  const seconds = typeof d.seconds === 'string' ? Number(d.seconds) : d.seconds
  return (seconds ?? 0) * 1000 + (d.nanos ?? 0) / 1e6
}

/** Google's streaming response subset we read. `words` is present only when
 * `enableWordTimeOffsets` is set and only on final results. */
interface StreamingResponse {
  results?: {
    isFinal?: boolean
    alternatives?: {
      transcript?: string
      confidence?: number
      words?: {
        word?: string
        startTime?: GoogleDuration
        endTime?: GoogleDuration
        confidence?: number
      }[]
    }[]
  }[]
}

export class GoogleCloudTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'google-cloud'
  private client: SpeechClient | null = null

  /** Lazily created so `browser`/`none` modes never touch credentials. */
  private speechClient(): SpeechClient {
    if (!this.client) this.client = new SpeechClient(speechClientOptions())
    return this.client
  }

  startStream(options: TranscriptionStreamOptions): TranscriptionStream {
    const client = this.speechClient()
    const events = new AsyncQueue<TranscriptionEvent>()
    // LINEAR16 mono: 2 bytes/sample, so this converts a byte count to the
    // audio time it represents — the basis for session-absolute word offsets.
    const sampleRateHertz = options.sampleRateHertz ?? 16_000
    const bytesToMs = (bytes: number): number =>
      (bytes / (sampleRateHertz * 2)) * 1000

    // The client library takes the streaming config as its argument and sends
    // it as the first request itself, then wraps every value written to the
    // stream as `audioContent` — so we pass the config here and write raw PCM
    // (writing request objects ourselves makes Google reject the stream with
    // "Malordered Data Received").
    const streamingConfig = {
      config: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz,
        languageCode: toBcp47(options.languageCode),
        // Per-word timings + confidence power the GEN-4 diarization time-join.
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        ...(options.phraseHints?.length
          ? { speechContexts: [{ phrases: options.phraseHints }] }
          : {}),
      },
      interimResults: true,
    }

    let recognize: RecognizeStream | null = null
    let ended = false
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    // Word offsets from Google reset to 0 on every restart, so we keep the
    // audio time already consumed by prior streams (`sessionByteOffset`) and
    // the live stream's own bytes (`currentStreamBytes`), and add the former
    // to each word so timings stay absolute to the whole recording session.
    let sessionByteOffset = 0
    let currentStreamBytes = 0

    // (Re)opens the underlying gRPC stream and re-arms the restart timer.
    const open = (): void => {
      if (ended) return
      // Captured per stream at open time: data events fire after later writes
      // have grown the accumulator, so the base must be frozen here.
      const streamBaseMs = bytesToMs(sessionByteOffset)
      const stream = client.streamingRecognize(
        streamingConfig,
      ) as unknown as RecognizeStream
      stream.on('data', (response: unknown) => {
        const { results } = response as StreamingResponse
        const result = results?.[0]
        const alternative = result?.alternatives?.[0]
        const transcript = alternative?.transcript
        if (!transcript) return
        const isFinal = Boolean(result?.isFinal)
        // Word timings are only stable (and only returned) on final results.
        const words: WordTiming[] | undefined =
          isFinal && alternative?.words?.length
            ? alternative.words.map(w => ({
                word: w.word ?? '',
                startMs: streamBaseMs + durationToMs(w.startTime),
                endMs: streamBaseMs + durationToMs(w.endTime),
                ...(typeof w.confidence === 'number'
                  ? { confidence: w.confidence }
                  : {}),
              }))
            : undefined
        events.push({
          text: transcript,
          isFinal,
          confidence: alternative?.confidence ?? 0,
          ...(words ? { words } : {}),
        })
      })
      stream.on('error', (error: { code?: number }) => {
        // The max-duration error is expected on long streams — cycle quietly;
        // anything else (bad language code, auth, quota) ends the session and
        // is logged so it is diagnosable instead of silently producing nothing.
        if (error.code === OUT_OF_RANGE && !ended) restart()
        else if (!ended) {
          console.error('Google Cloud STT stream error:', error)
          events.close()
        }
      })
      recognize = stream
      restartTimer = setTimeout(restart, STREAM_RESTART_MS)
    }

    // Swaps to a fresh stream so audio keeps flowing past Google's limit.
    const restart = (): void => {
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = null
      // Commit the outgoing stream's audio to the session offset before the
      // new stream captures its (now higher) base — keeps word times absolute.
      sessionByteOffset += currentStreamBytes
      currentStreamBytes = 0
      const old = recognize
      recognize = null
      open()
      old?.end()
    }

    open()

    return {
      write(chunk: Uint8Array) {
        // Raw PCM; the client library wraps it as audioContent. Count the
        // bytes so word offsets can be made session-absolute across restarts.
        if (ended) return
        currentStreamBytes += chunk.byteLength
        recognize?.write(chunk)
      },
      end() {
        ended = true
        if (restartTimer) clearTimeout(restartTimer)
        recognize?.end()
        events.close()
      },
      events,
    }
  }
}

registry.register(
  'transcription',
  'google-cloud',
  () => new GoogleCloudTranscriptionProvider(),
)

/**
 * Health probe for Google Cloud Speech-to-Text (used by GET /api/health).
 * STT is only server-side when `google-cloud` is the active engine — the
 * keyless 'browser'/'none'/'mock' modes report `disabled`. When active, we
 * fetch an access token from the service account (free, no STT call), which
 * verifies both the credentials and reachability.
 */
export const pingGoogleStt = async (): Promise<HealthComponent> => {
  const provider = env.TRANSCRIPTION_PROVIDER
  if (provider === 'browser')
    return { status: 'disabled', detail: 'browser (client-side)' }
  if (provider === 'none') return { status: 'disabled', detail: 'none' }
  if (provider !== 'google-cloud')
    return { status: 'disabled', detail: provider }

  const hasCreds = Boolean(
    env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    env.GOOGLE_APPLICATION_CREDENTIALS,
  )
  if (!hasCreds) return { status: 'down', detail: 'no credentials' }

  let client: SpeechClient | undefined
  try {
    client = new SpeechClient(speechClientOptions())
    await client.auth.getAccessToken()
    return { status: 'ok', detail: 'connected' }
  } catch (error) {
    return {
      status: 'down',
      detail: error instanceof Error ? error.name : 'unreachable',
    }
  } finally {
    await client?.close().catch(() => {})
  }
}
