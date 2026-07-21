/**
 * Runtime configuration fetched from the server at boot (GET /api/config).
 * Unlike build-time VITE_ vars, this lets one server flip switch behavior —
 * currently the live-session speech engine — with no client rebuild.
 *
 * `loadRuntimeConfig` runs once during startup; `getSttEngine` reads the
 * cached value synchronously (the STT capture seam needs it at page mount).
 * A failed fetch falls back to the keyless browser engine.
 */
import type { RuntimeConfig, SttEngine } from '@slide-machine/shared'
import { config } from './config'

let runtime: RuntimeConfig = {
  sttEngine: 'browser',
  ttsEnabled: false,
  refineSlidesDefaultLevel: 2,
  refineTranscriptDefaultLevel: 2,
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

/** Default strength (1–5) the "Refine all slides" slider starts at (GEN-4). */
export const getRefineSlidesDefaultLevel = (): number =>
  runtime.refineSlidesDefaultLevel

/** Default strength (1–5) the "Refine the spoken transcript" slider starts at. */
export const getRefineTranscriptDefaultLevel = (): number =>
  runtime.refineTranscriptDefaultLevel
