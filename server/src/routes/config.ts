/**
 * GET /api/config — public runtime configuration the client reads at boot.
 * Exposes the active speech engine (TRANSCRIPTION_PROVIDER) so switching STT
 * is a single server flip with no client rebuild. No secrets belong here.
 */
import { Router } from 'express'
import type { RuntimeConfig, SttEngine } from '@slide-machine/shared'
import { env } from '../config/env'
import { serverTranscriptionAvailable } from '../lib/transcribe-audio'
import { translationEnabled } from '../lib/translate-slides'
import { feedbackEnabled } from './feedback'

export const configRouter = Router()

/**
 * Maps the transcription adapter name to the client's capture engine:
 * 'browser' and 'none' pass through; any other adapter ('google-cloud',
 * 'mock', a future 'whisper', …) uses the WebSocket streaming path — the same
 * ones that can transcribe a finished recording server-side, which is why the
 * client reads this to decide whether re-transcribing a slide is offered.
 */
const sttEngine = (): SttEngine => {
  if (!serverTranscriptionAvailable())
    return env.TRANSCRIPTION_PROVIDER as SttEngine
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
    translationEnabled: translationEnabled(),
    feedbackEnabled: feedbackEnabled(),
    operator: {
      name: env.OPERATOR_NAME,
      jurisdiction: env.OPERATOR_JURISDICTION,
      contactEmail: env.OPERATOR_CONTACT_EMAIL,
      postalAddress: env.OPERATOR_POSTAL_ADDRESS,
    },
    refineSlidesDefaultLevel: env.REFINE_SLIDES_DEFAULT_LEVEL,
    refineTranscriptDefaultLevel: env.REFINE_TRANSCRIPT_DEFAULT_LEVEL,
    simulatedSpeechEnabled: env.SIMULATED_SPEECH_ENABLED,
    whiteboardSuppressDebounceMs: env.WHITEBOARD_SUPPRESS_DEBOUNCE_MS,
    sttCaptureSampleRate: env.STT_CAPTURE_SAMPLE_RATE,
  }
  res.json(body)
})
