/**
 * GET /api/config — public runtime configuration the client reads at boot.
 * Exposes the active speech engine (TRANSCRIPTION_PROVIDER) so switching STT
 * is a single server flip with no client rebuild. No secrets belong here.
 */
import { Router } from 'express'
import type {
  DrivePickerConfig,
  RuntimeConfig,
  SttEngine,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { serverTranscriptionAvailable } from '../lib/transcribe-audio'
import { translationEnabled } from '../lib/translate-slides'
import { feedbackEnabled } from './feedback'
import { googleLive } from '../lib/export-mode'
import { mailerAvailable } from '../lib/mailer'
import { oauthAvailable } from './oauth'
import { defaultTemplateId } from '../templates/builtin'

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

/**
 * Which Drive chooser the client should open.
 *
 * Mock unless the deployment actually talks to Google — either for exports or
 * for quiz publishing — so a dev machine and the test suite get the app's own
 * dialog over a fabricated tree. Live, it is Google's Picker: the app holds
 * only `drive.file` and cannot list a Drive itself. Live with no Picker key is
 * a misconfiguration, and says so rather than opening a chooser that would
 * come back empty.
 */
const drivePicker = (): DrivePickerConfig => {
  if (!googleLive()) return { mode: 'mock' }
  if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_PICKER_APP_ID)
    return { mode: 'none' }
  return {
    mode: 'google',
    apiKey: env.GOOGLE_PICKER_API_KEY,
    appId: env.GOOGLE_PICKER_APP_ID,
  }
}

configRouter.get('/config', (_req, res) => {
  const body: RuntimeConfig = {
    agentAccessEnabled: oauthAvailable(),
    sttEngine: sttEngine(),
    ttsEnabled: ttsEnabled(),
    translationEnabled: translationEnabled(),
    feedbackEnabled: feedbackEnabled(),
    mailEnabled: mailerAvailable(),
    operator: {
      name: env.OPERATOR_NAME,
      jurisdiction: env.OPERATOR_JURISDICTION,
      contactEmail: env.OPERATOR_CONTACT_EMAIL,
      postalAddress: env.OPERATOR_POSTAL_ADDRESS,
    },
    // Resolved rather than echoed from env: a configured id the template set
    // does not hold is ignored there, and the client should be told what the
    // server will actually use.
    defaultTemplateId: defaultTemplateId(),
    refineSlidesDefaultLevel: env.REFINE_SLIDES_DEFAULT_LEVEL,
    refineTranscriptDefaultLevel: env.REFINE_TRANSCRIPT_DEFAULT_LEVEL,
    simulatedSpeechEnabled: env.SIMULATED_SPEECH_ENABLED,
    whiteboardSuppressDebounceMs: env.WHITEBOARD_SUPPRESS_DEBOUNCE_MS,
    interimFlushEnabled: env.GENERATION_INTERIM_FLUSH,
    interimFlushWords: env.GENERATION_INTERIM_FLUSH_WORDS,
    sttCaptureSampleRate: env.STT_CAPTURE_SAMPLE_RATE,
    drivePicker: drivePicker(),
  }
  res.json(body)
})
