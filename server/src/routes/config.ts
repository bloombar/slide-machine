/**
 * GET /api/config — public runtime configuration the client reads at boot.
 * Exposes the active speech engine (TRANSCRIPTION_PROVIDER) so switching STT
 * is a single server flip with no client rebuild. No secrets belong here.
 */
import { Router } from 'express'
import type { RuntimeConfig, SttEngine } from '@slide-machine/shared'
import { env } from '../config/env'

export const configRouter = Router()

/**
 * Maps the transcription adapter name to the client's capture engine:
 * 'browser' and 'none' pass through; any other adapter ('google-cloud',
 * 'mock', a future 'whisper', …) uses the WebSocket streaming path.
 */
const sttEngine = (): SttEngine => {
  const provider = env.TRANSCRIPTION_PROVIDER
  if (provider === 'browser' || provider === 'none') return provider
  return 'google-cloud'
}

/** TTS is usable when a provider is selected and (for Google) a key is set;
 * false hides the play button and per-slide "Speak this slide" on the client. */
const ttsEnabled = (): boolean => {
  const provider = env.TTS_PROVIDER
  if (provider === 'none') return false
  if (provider === 'google-cloud') return Boolean(env.GOOGLE_CLOUD_TTS_KEY)
  return true
}

configRouter.get('/config', (_req, res) => {
  const body: RuntimeConfig = {
    sttEngine: sttEngine(),
    ttsEnabled: ttsEnabled(),
    refineSlidesDefaultLevel: env.REFINE_SLIDES_DEFAULT_LEVEL,
    refineTranscriptDefaultLevel: env.REFINE_TRANSCRIPT_DEFAULT_LEVEL,
    whiteboardSuppressDebounceMs: env.WHITEBOARD_SUPPRESS_DEBOUNCE_MS,
  }
  res.json(body)
})
