/**
 * Google Cloud Text-to-Speech adapter (TECH-8). Synthesizes plain text into
 * MP3 audio via the REST API with a plain API key (`GOOGLE_CLOUD_TTS_KEY`) —
 * the same hand-rolled-fetch + key-header pattern as the Gemini adapter, no
 * SDK. Kept behind the vendor-neutral `TtsProvider` interface so the
 * synthesizer can be swapped without touching the route or client.
 */
import type {
  HealthComponent,
  TtsProvider,
  TtsSynthesisInput,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'

const API_BASE = 'https://texttospeech.googleapis.com/v1'
/** Bounded so a hung synth can't stall the request that awaits it. */
const SYNTHESIZE_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 2000

export class GoogleCloudTtsProvider implements TtsProvider {
  readonly name = 'google-cloud'
  readonly audioMimeType = 'audio/mpeg'

  async synthesize({
    text,
    languageCode,
    voiceName,
  }: TtsSynthesisInput): Promise<Uint8Array> {
    if (!env.GOOGLE_CLOUD_TTS_KEY) {
      throw new Error('Text-to-speech is not configured (no API key)')
    }
    const res = await fetch(`${API_BASE}/text:synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GOOGLE_CLOUD_TTS_KEY,
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode,
          ...(voiceName ? { name: voiceName } : {}),
          ssmlGender: 'NEUTRAL',
        },
        audioConfig: { audioEncoding: 'MP3' },
      }),
      signal: AbortSignal.timeout(SYNTHESIZE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Text-to-speech request failed (${res.status}): ${detail.slice(0, 500)}`,
      )
    }
    const data = (await res.json()) as { audioContent?: string }
    if (!data.audioContent) {
      throw new Error('Text-to-speech returned no audio')
    }
    return Buffer.from(data.audioContent, 'base64')
  }
}

/**
 * Health probe for the footer badge: `disabled` without a key (the feature is
 * simply off, not broken), otherwise a cheap voices-list call that verifies
 * the key/API before reporting `ok`. Never throws — a failure reads as `down`.
 */
export const pingGoogleTts = async (): Promise<HealthComponent> => {
  if (!env.GOOGLE_CLOUD_TTS_KEY) {
    return { status: 'disabled', detail: 'no key' }
  }
  try {
    const res = await fetch(`${API_BASE}/voices`, {
      headers: { 'x-goog-api-key': env.GOOGLE_CLOUD_TTS_KEY },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
      ? { status: 'ok', detail: 'ready' }
      : { status: 'down', detail: `http ${res.status}` }
  } catch {
    return { status: 'down', detail: 'error' }
  }
}

registry.register('tts', 'google-cloud', () => new GoogleCloudTtsProvider())
