/**
 * Client-side speech capture behind one seam (CAP-1). The engine is chosen
 * at runtime by the server's TRANSCRIPTION_PROVIDER (read via /api/config),
 * so one server flip switches the whole app — no client rebuild:
 *
 * - 'browser' — the Web Speech API (Chrome/Edge/Safari; Chrome relays
 *   audio to Google under the hood). Keyless.
 * - 'google-cloud' — streams mic PCM to the server over a WebSocket, which
 *   relays to Google Cloud STT and streams transcripts back. The UI is
 *   identical to the browser engine.
 * - 'none' — capture disabled; the typed Speak bar remains.
 *
 * Finalized phrases feed the same session.phrase pipeline as typed
 * input, so generation behaves identically for every engine.
 */
import type { WordTiming } from '@slide-machine/shared'
import { config } from '../config'
import { getAccessToken, refreshSession } from '../auth/token'
import { getSttEngine } from '../runtime-config'

/**
 * Metadata accompanying a finalized phrase (GEN-4 diarization groundwork).
 * `sessionId` groups a recording's phrases (one per capture start); `words`
 * and `confidence` come only from the google-cloud engine.
 */
export interface PhraseMeta {
  sessionId: string
  confidence?: number
  words?: WordTiming[]
}

export interface SpeechCaptureHandlers {
  /** One finalized phrase, ready for session.phrase, with capture metadata. */
  onPhrase: (phrase: string, meta?: PhraseMeta) => void
  /** Volatile in-progress transcript, for display only. */
  onInterim?: (text: string) => void
  /** Capture became unusable (permission denied, no service). */
  onError?: (message: string) => void
}

/** A fresh recording-session id, minted at each capture start. Falls back to a
 * timestamp+random id where crypto.randomUUID is unavailable (older/insecure
 * contexts, some test environments). */
const newSessionId = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

export interface SpeechCapture {
  /** False when this provider can't run in the current browser. */
  readonly available: boolean
  /** `lang` is the resolved lecture language (lecture ?? project ??
   * profile); omitted = the browser's own language. */
  start(handlers: SpeechCaptureHandlers, lang?: string): void
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

/** Give up after this many immediate start→end cycles (no speech
 * service, headless browsers) instead of restarting forever — and
 * surface the failure, so the mic never looks live while capture is
 * dead. */
const MAX_RAPID_RESTARTS = 5
const RAPID_RESTART_MS = 1000

const browserCapture = (): SpeechCapture => {
  let recognition: Recognition | null = null
  let active = false
  let rapidRestarts = 0
  let lastStart = 0

  return {
    get available() {
      return recognitionCtor() !== undefined
    },
    start(handlers, lang) {
      const Ctor = recognitionCtor()
      if (!Ctor || active) return
      active = true
      // One id for this whole recording; the browser engine has no server-side
      // timing, so phrases carry only the session id.
      const sessionId = newSessionId()
      recognition = new Ctor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = lang || navigator.language || 'en-US'
      recognition.onresult = e => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]!
          const transcript = result[0].transcript.trim()
          if (!transcript) continue
          if (result.isFinal) {
            handlers.onPhrase(transcript, { sessionId })
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
        if (!active) return
        // Browsers stop recognition after silence; keep listening — but
        // an immediate start→end cycle means capture can't run here, so
        // give up and report it instead of spinning
        if (Date.now() - lastStart < RAPID_RESTART_MS) {
          rapidRestarts++
          if (rapidRestarts >= MAX_RAPID_RESTARTS) {
            active = false
            handlers.onError?.(
              'Microphone unavailable — speech recognition keeps stopping',
            )
            return
          }
        } else {
          rapidRestarts = 0
        }
        lastStart = Date.now()
        recognition?.start()
      }
      lastStart = Date.now()
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

/** Builds the authenticated STT WebSocket URL. Browsers can't set an
 * Authorization header on a WebSocket, so the access token rides in the
 * query string; the server verifies it on the handshake. */
const sttSocketUrl = (token: string): string => {
  const httpBase = config.apiBaseUrl || window.location.origin
  const wsBase = httpBase.replace(/^http/, 'ws')
  return `${wsBase}/api/stt?token=${encodeURIComponent(token)}`
}

/** True when the access token can't be read or expires within the skew
 * window. Unlike HTTP calls, the STT socket has no reactive 401-refresh
 * (see api/http.ts), so we must hand the handshake a token that stays valid
 * for its duration — an expired one is rejected on the upgrade and the mic
 * dies with no server-side trace. Undecodable tokens are treated as stale. */
const tokenExpiresSoon = (token: string, skewSeconds = 60): boolean => {
  try {
    const payload = token.split('.')[1]!
    const { exp } = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number }
    return (
      typeof exp !== 'number' || exp * 1000 - Date.now() < skewSeconds * 1000
    )
  } catch {
    return true
  }
}

/**
 * Streams mic audio to the server's Cloud STT adapter over a WebSocket and
 * feeds transcripts through the same handlers as the browser engine, so the
 * live-session UI is unchanged.
 */
const googleCloudCapture = (): SpeechCapture => {
  let active = false
  let ws: WebSocket | null = null
  let audioContext: AudioContext | null = null
  let mediaStream: MediaStream | null = null
  let workletNode: AudioWorkletNode | null = null

  const teardown = (): void => {
    workletNode?.disconnect()
    workletNode = null
    if (audioContext && audioContext.state !== 'closed')
      void audioContext.close()
    audioContext = null
    mediaStream?.getTracks().forEach(track => track.stop())
    mediaStream = null
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
    ws = null
  }

  return {
    get available() {
      return (
        typeof window !== 'undefined' &&
        window.isSecureContext &&
        typeof WebSocket !== 'undefined' &&
        typeof AudioContext !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia)
      )
    },
    start(handlers, lang) {
      if (active) return
      active = true
      // One id for this whole recording (this WS = one server-side stream);
      // a later stop→start mints a new one, marking a session boundary.
      const sessionId = newSessionId()

      // Any fatal condition stops capture and surfaces once, so the mic never
      // looks live while the stream is dead.
      const fail = (message: string): void => {
        if (!active) return
        active = false
        teardown()
        handlers.onError?.(message)
      }

      void (async () => {
        // Hand the handshake a token that will still be valid: refresh a
        // missing or soon-to-expire one first, and trust only the refreshed
        // value so a stale token is never sent (the server 401s it on the
        // upgrade, killing the mic silently).
        let token = getAccessToken()
        if (!token || tokenExpiresSoon(token)) {
          const refreshed = await refreshSession()
          if (!active) return
          token = refreshed?.accessToken ?? null
        }
        if (!token) return fail('Sign in to use speech recognition')

        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch {
          return fail('Microphone unavailable — check permissions')
        }
        if (!active) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        mediaStream = stream

        try {
          const ctx = new AudioContext()
          audioContext = ctx
          // Autoplay policy can start the context suspended; resume so the
          // worklet actually pulls audio.
          void ctx.resume?.()
          await ctx.audioWorklet.addModule(
            new URL('./pcm-worklet.js', import.meta.url).href,
          )
          if (!active) return teardown()

          const source = ctx.createMediaStreamSource(stream)
          const node = new AudioWorkletNode(ctx, 'pcm-processor')
          workletNode = node
          // A muted sink keeps the graph pulling audio without echoing to
          // the speakers.
          const sink = ctx.createGain()
          sink.gain.value = 0
          source.connect(node)
          node.connect(sink)
          sink.connect(ctx.destination)

          const socket = new WebSocket(sttSocketUrl(token))
          ws = socket
          socket.binaryType = 'arraybuffer'
          node.port.onmessage = event => {
            if (socket.readyState === WebSocket.OPEN)
              socket.send(event.data as ArrayBuffer)
          }
          socket.onopen = () => {
            socket.send(
              JSON.stringify({
                type: 'start',
                languageCode: lang,
                sampleRate: ctx.sampleRate,
              }),
            )
          }
          socket.onmessage = event => {
            let message: {
              type?: string
              text?: string
              message?: string
              confidence?: number
              words?: WordTiming[]
            }
            try {
              message = JSON.parse(event.data as string)
            } catch {
              return
            }
            if (message.type === 'interim') {
              handlers.onInterim?.(message.text ?? '')
            } else if (message.type === 'final') {
              handlers.onInterim?.('')
              if (message.text)
                handlers.onPhrase(message.text, {
                  sessionId,
                  ...(typeof message.confidence === 'number'
                    ? { confidence: message.confidence }
                    : {}),
                  ...(message.words?.length ? { words: message.words } : {}),
                })
            } else if (message.type === 'error') {
              fail(message.message ?? 'Speech service unavailable')
            }
          }
          socket.onerror = () => fail('Speech service unavailable')
          socket.onclose = () => fail('Speech service disconnected')
        } catch {
          return fail('Speech recognition failed to start')
        }
      })()
    },
    stop() {
      active = false
      teardown()
    },
  }
}

export const createSpeechCapture = (
  provider: string = getSttEngine(),
): SpeechCapture => {
  if (provider === 'browser') return browserCapture()
  if (provider === 'google-cloud') return googleCloudCapture()
  // 'none' and unknown values disable capture, leaving the typed Speak bar.
  return unavailableCapture
}
