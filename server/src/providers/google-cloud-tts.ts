/**
 * Google Cloud Text-to-Speech adapter (TECH-8). Synthesizes plain text into
 * MP3 audio via the REST API with a plain API key (`GOOGLE_CLOUD_TTS_KEY`) —
 * the same hand-rolled-fetch + key-header pattern as the Gemini adapter, no
 * SDK. Kept behind the vendor-neutral `TtsProvider` interface so the
 * synthesizer can be swapped without touching the route or client.
 */
import type {
  HealthComponent,
  TtsMark,
  TtsProvider,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { buildMarkedSsml } from '../tts/ssml'
import { registry } from './registry'

// v1beta1 is required for SSML `<mark>` timepoints (enableTimePointing).
const API_BASE = 'https://texttospeech.googleapis.com/v1beta1'
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
    gender,
  }: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    if (!env.GOOGLE_CLOUD_TTS_KEY) {
      throw new Error('Text-to-speech is not configured (no API key)')
    }
    // A specific name wins; otherwise the gender selects a matching voice in
    // the requested language, or Google's default when neither is set.
    const voice = {
      languageCode,
      ...(voiceName ? { name: voiceName } : {}),
      ...(gender ? { ssmlGender: gender.toUpperCase() } : {}),
    }

    // Preferred path: SSML with `<mark>`s + timepoints, so playback gets the
    // real spoken time of each phrase boundary.
    const { ssml, marks: markRefs } = buildMarkedSsml(text)
    const ssmlResult = await this.request(
      {
        input: { ssml },
        voice,
        audioConfig: { audioEncoding: 'MP3' },
        enableTimePointing: ['SSML_MARK'],
      },
      markRefs,
    )
    if (ssmlResult) return ssmlResult

    // Fallback: some voices (e.g. Chirp/HD) reject SSML. Re-synthesize the
    // plain text with no marks — playback degrades to the linear proxy.
    const plainResult = await this.request(
      { input: { text }, voice, audioConfig: { audioEncoding: 'MP3' } },
      [],
    )
    if (!plainResult) throw new Error('Text-to-speech returned no audio')
    return plainResult
  }

  /**
   * POSTs one synthesize request. Returns null on a 400 (so the caller can try
   * a simpler request — SSML voices vs. plain), throws on other failures.
   * Joins the response `timepoints` to plain-text offsets via the mark refs.
   */
  private async request(
    body: unknown,
    markRefs: { name: string; charOffset: number }[],
  ): Promise<TtsSynthesisResult | null> {
    const res = await fetch(`${API_BASE}/text:synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GOOGLE_CLOUD_TTS_KEY!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SYNTHESIZE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // 400 usually means the voice rejected the SSML/timepointing; signal the
      // caller to retry with a plainer request rather than failing outright.
      if (res.status === 400) return null
      throw new Error(
        `Text-to-speech request failed (${res.status}): ${detail.slice(0, 500)}`,
      )
    }
    const data = (await res.json()) as {
      audioContent?: string
      timepoints?: Array<{ markName?: string; timeSeconds?: number }>
    }
    if (!data.audioContent) throw new Error('Text-to-speech returned no audio')
    const offsetByName = new Map(markRefs.map(m => [m.name, m.charOffset]))
    const marks: TtsMark[] = (data.timepoints ?? [])
      .filter(t => t.markName != null && offsetByName.has(t.markName))
      .map(t => ({
        charOffset: offsetByName.get(t.markName!)!,
        timeSeconds: t.timeSeconds ?? 0,
      }))
      .sort((a, b) => a.charOffset - b.charOffset)
    return { audio: Buffer.from(data.audioContent, 'base64'), marks }
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
