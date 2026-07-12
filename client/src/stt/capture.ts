/**
 * Client-side speech capture behind one seam (CAP-1), selected by
 * VITE_STT_PROVIDER:
 *
 * - 'browser' — the Web Speech API (Chrome/Edge/Safari; Chrome relays
 *   audio to Google under the hood). Keyless bridge until Google Cloud
 *   STT credentials exist.
 * - 'google-cloud' — reserved: will stream audio to the server, which
 *   uses its TRANSCRIPTION_PROVIDER adapter. Flipping the env var is
 *   the whole switch; the UI stays identical.
 * - 'none' — capture disabled; the typed Speak bar remains.
 *
 * Finalized phrases feed the same session.phrase pipeline as typed
 * input, so generation behaves identically either way.
 */
import { config } from '../config'

export interface SpeechCaptureHandlers {
  /** One finalized phrase, ready for session.phrase. */
  onPhrase: (phrase: string) => void
  /** Volatile in-progress transcript, for display only. */
  onInterim?: (text: string) => void
  /** Capture became unusable (permission denied, no service). */
  onError?: (message: string) => void
}

export interface SpeechCapture {
  /** False when this provider can't run in the current browser. */
  readonly available: boolean
  start(handlers: SpeechCaptureHandlers): void
  stop(): void
}

/** The Web Speech API subset we use (not in TS's DOM lib everywhere). */
interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
interface RecognitionErrorEvent {
  error: string
}
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: RecognitionResultEvent) => void) | null
  onerror: ((e: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition

const recognitionCtor = (): RecognitionCtor | undefined => {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** Permission/service failures worth surfacing; the rest just restart. */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
])

const browserCapture = (): SpeechCapture => {
  let recognition: Recognition | null = null
  let active = false

  return {
    get available() {
      return recognitionCtor() !== undefined
    },
    start(handlers) {
      const Ctor = recognitionCtor()
      if (!Ctor || active) return
      active = true
      recognition = new Ctor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = navigator.language || 'en-US'
      recognition.onresult = e => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]!
          const transcript = result[0].transcript.trim()
          if (!transcript) continue
          if (result.isFinal) {
            handlers.onPhrase(transcript)
          } else {
            interim = transcript
          }
        }
        handlers.onInterim?.(interim)
      }
      recognition.onerror = e => {
        if (FATAL_ERRORS.has(e.error)) {
          active = false
          handlers.onError?.('Microphone unavailable — check permissions')
        }
        // Transient errors (no-speech, network blips) fall through to
        // onend, which restarts while still active
      }
      recognition.onend = () => {
        // Browsers stop recognition after silence; keep listening
        if (active) recognition?.start()
      }
      recognition.start()
    },
    stop() {
      active = false
      recognition?.stop()
      recognition = null
    },
  }
}

const unavailableCapture: SpeechCapture = {
  available: false,
  start() {},
  stop() {},
}

export const createSpeechCapture = (
  provider: string = config.sttProvider,
): SpeechCapture => {
  if (provider === 'browser') return browserCapture()
  // 'google-cloud' arrives with the server streaming path; 'none' and
  // unknown values disable capture, leaving the typed Speak bar
  return unavailableCapture
}
