/**
 * Runtime configuration fetched from the server at boot (GET /api/config).
 * Unlike build-time VITE_ vars, this lets one server flip switch behavior —
 * currently the live-session speech engine — with no client rebuild.
 *
 * `loadRuntimeConfig` runs once during startup; `getSttEngine` reads the
 * cached value synchronously (the STT capture seam needs it at page mount).
 * A failed fetch falls back to the keyless browser engine.
 */
import type {
  OperatorDetails,
  RuntimeConfig,
  SttEngine,
} from '@slide-machine/shared'
import { config } from './config'

/** Nothing said either way. Blank until config loads, and blank on a server
 * that names no operator: the static pages substitute their own placeholder
 * per field. Also what an older server's response is read as — the body is
 * taken on trust, so the one object in it needs a stand-in rather than a
 * property access on undefined. */
const NO_OPERATOR: OperatorDetails = {
  name: '',
  jurisdiction: '',
  contactEmail: '',
  postalAddress: '',
}

let runtime: RuntimeConfig = {
  sttEngine: 'browser',
  ttsEnabled: false,
  translationEnabled: false,
  feedbackEnabled: false,
  operator: NO_OPERATOR,
  refineSlidesDefaultLevel: 2,
  refineTranscriptDefaultLevel: 2,
  simulatedSpeechEnabled: false,
  whiteboardSuppressDebounceMs: 5000,
  sttCaptureSampleRate: 24000,
}
let loaded: Promise<RuntimeConfig> | null = null

/** Fetches runtime config once and caches it; safe to call repeatedly. */
export const loadRuntimeConfig = (): Promise<RuntimeConfig> => {
  loaded ??= fetch(`${config.apiBaseUrl}/api/config`)
    .then(res => (res.ok ? (res.json() as Promise<RuntimeConfig>) : runtime))
    .catch(() => runtime)
    .then(cfg => {
      runtime = cfg
      return cfg
    })
  return loaded
}

/** The speech engine the client should use; 'browser' until config loads. */
export const getSttEngine = (): SttEngine => runtime.sttEngine

/** Whether TTS playback is available; false (feature hidden) until config loads. */
export const getTtsEnabled = (): boolean => runtime.ttsEnabled

/** Whether translated viewing is available (SHARE-2); false (switcher hidden)
 * until config loads. */
export const getTranslationEnabled = (): boolean => runtime.translationEnabled

/** Whether the "Send feedback" form can deliver; false (menu entry and page
 * hidden) until config loads. A server with no mail transport or no address
 * to send to has no use for the form. */
export const getFeedbackEnabled = (): boolean => runtime.feedbackEnabled

/** Who runs this deployment, as the privacy policy and the terms name them.
 * Fields the server left blank are filled in by the documents themselves
 * (content/document.ts), which have placeholders for exactly that. */
export const getOperator = (): OperatorDetails =>
  runtime.operator ?? NO_OPERATOR

/** Default strength (1–5) the "Refine all slides" slider starts at (GEN-4). */
export const getRefineSlidesDefaultLevel = (): number =>
  runtime.refineSlidesDefaultLevel

/** Default strength (1–5) the "Refine the spoken transcript" slider starts at. */
export const getRefineTranscriptDefaultLevel = (): number =>
  runtime.refineTranscriptDefaultLevel

/** Debug aid: whether the live session shows the "simulated speech" text box
 * for typing phrases instead of speaking them; false (hidden) until config
 * loads. Real STT is the normal path — this is for driving a session without a
 * microphone. */
export const getSimulatedSpeechEnabled = (): boolean =>
  runtime.simulatedSpeechEnabled

/** How long (ms) after the last drawing gesture the client keeps suppressing
 * auto-slide-creation while recording (WB-3). */
export const getWhiteboardSuppressDebounceMs = (): number =>
  runtime.whiteboardSuppressDebounceMs

/** Rate (Hz) mic capture downsamples to before streaming (CAP-3). */
export const getSttCaptureSampleRate = (): number =>
  runtime.sttCaptureSampleRate
