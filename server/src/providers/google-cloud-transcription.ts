/**
 * Google Cloud Speech-to-Text streaming adapter (SPEC CAP-3 / TECH-8).
 * Relays PCM audio to Google's `streamingRecognize` gRPC stream and adapts
 * its results to the capability-neutral TranscriptionProvider interface, so
 * the WebSocket transport and the client stay engine-agnostic.
 *
 * Real-time streaming needs a service-account credential (an API key is
 * rejected by the streaming endpoint); it is read from
 * GOOGLE_APPLICATION_CREDENTIALS. See docs/GOOGLE_API_KEYS.md.
 */
import { SpeechClient } from '@google-cloud/speech'
import type {
  TranscriptionEvent,
  TranscriptionProvider,
  TranscriptionStream,
  TranscriptionStreamOptions,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { AsyncQueue } from './async-queue'

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

/** Google's streaming response subset we read. */
interface StreamingResponse {
  results?: {
    isFinal?: boolean
    alternatives?: { transcript?: string; confidence?: number }[]
  }[]
}

export class GoogleCloudTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'google-cloud'
  private client: SpeechClient | null = null

  /** Lazily created so `browser`/`none` modes never touch credentials. */
  private speechClient(): SpeechClient {
    if (!this.client)
      this.client = new SpeechClient(
        env.GOOGLE_APPLICATION_CREDENTIALS
          ? { keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS }
          : {},
      )
    return this.client
  }

  startStream(options: TranscriptionStreamOptions): TranscriptionStream {
    const client = this.speechClient()
    const events = new AsyncQueue<TranscriptionEvent>()

    // The client library takes the streaming config as its argument and sends
    // it as the first request itself, then wraps every value written to the
    // stream as `audioContent` — so we pass the config here and write raw PCM
    // (writing request objects ourselves makes Google reject the stream with
    // "Malordered Data Received").
    const streamingConfig = {
      config: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: options.sampleRateHertz ?? 16_000,
        languageCode: toBcp47(options.languageCode),
        ...(options.phraseHints?.length
          ? { speechContexts: [{ phrases: options.phraseHints }] }
          : {}),
      },
      interimResults: true,
    }

    let recognize: RecognizeStream | null = null
    let ended = false
    let restartTimer: ReturnType<typeof setTimeout> | null = null

    // (Re)opens the underlying gRPC stream and re-arms the restart timer.
    const open = (): void => {
      if (ended) return
      const stream = client.streamingRecognize(
        streamingConfig,
      ) as unknown as RecognizeStream
      stream.on('data', (response: unknown) => {
        const { results } = response as StreamingResponse
        const result = results?.[0]
        const transcript = result?.alternatives?.[0]?.transcript
        if (!transcript) return
        events.push({
          text: transcript,
          isFinal: Boolean(result?.isFinal),
          confidence: result?.alternatives?.[0]?.confidence ?? 0,
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
      const old = recognize
      recognize = null
      open()
      old?.end()
    }

    open()

    return {
      write(chunk: Uint8Array) {
        // Raw PCM; the client library wraps it as audioContent.
        if (!ended) recognize?.write(chunk)
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
