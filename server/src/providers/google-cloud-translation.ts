/**
 * Google Cloud Translation adapter (TECH-8), backing post-lecture translated
 * viewing (SHARE-2). Uses the v2 REST endpoint with a plain API key
 * (`GOOGLE_CLOUD_TRANSLATION_KEY`) — the same hand-rolled-fetch + key-header
 * pattern as the TTS and Gemini adapters, no SDK. Kept behind the
 * vendor-neutral `TranslationProvider` so the translator can be swapped
 * without touching the viewer, the cache, or the exports.
 */
import type {
  HealthComponent,
  Locale,
  TranslationInput,
  TranslationProvider,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'

const API_BASE = 'https://translation.googleapis.com/language/translate/v2'
/** Bounded so a hung translation can't stall the request that awaits it. */
const TRANSLATE_TIMEOUT_MS = 15_000
const HEALTH_TIMEOUT_MS = 2000

/**
 * Locale → Google Translate target code. Only Mandarin differs from the bare
 * subtag: Translate wants a script/region (`zh-CN` = Simplified). Note this is
 * NOT the same mapping the speech adapter uses — its `cmn-Hans-CN` is a
 * Speech-to-Text code and Translate rejects it.
 */
const TRANSLATE_CODE: Record<Locale, string> = {
  en: 'en',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
  zh: 'zh-CN',
}

/**
 * Request limits. Google caps a v2 request at 128 segments, and very large
 * bodies are rejected outright, so a long deck is split into several requests
 * rather than failing as one.
 */
const MAX_SEGMENTS_PER_REQUEST = 100
const MAX_CHARS_PER_REQUEST = 15_000

/** Splits segments into batches that respect both the count and size caps. */
export const batchSegments = (texts: string[]): string[][] => {
  const batches: string[][] = []
  let batch: string[] = []
  let chars = 0
  for (const text of texts) {
    // A single oversized segment still goes out alone — better a provider
    // error naming the real problem than a silently dropped slide.
    if (
      batch.length &&
      (batch.length >= MAX_SEGMENTS_PER_REQUEST ||
        chars + text.length > MAX_CHARS_PER_REQUEST)
    ) {
      batches.push(batch)
      batch = []
      chars = 0
    }
    batch.push(text)
    chars += text.length
  }
  if (batch.length) batches.push(batch)
  return batches
}

export class GoogleCloudTranslationProvider implements TranslationProvider {
  readonly name = 'google-cloud'

  async translate({
    texts,
    source,
    target,
    format,
  }: TranslationInput): Promise<string[]> {
    if (!env.GOOGLE_CLOUD_TRANSLATION_KEY) {
      throw new Error('Translation is not configured (no API key)')
    }
    if (!texts.length) return []

    const results: string[] = []
    for (const batch of batchSegments(texts)) {
      results.push(...(await this.request(batch, source, target, format)))
    }
    return results
  }

  /** POSTs one batch and returns its translations in the order sent. */
  private async request(
    texts: string[],
    source: Locale | undefined,
    target: Locale,
    format: 'text' | 'html',
  ): Promise<string[]> {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GOOGLE_CLOUD_TRANSLATION_KEY!,
      },
      body: JSON.stringify({
        q: texts,
        target: TRANSLATE_CODE[target],
        ...(source ? { source: TRANSLATE_CODE[source] } : {}),
        format,
      }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Translation request failed (${res.status}): ${detail.slice(0, 500)}`,
      )
    }
    const data = (await res.json()) as {
      data?: { translations?: Array<{ translatedText?: string }> }
    }
    const translations = data.data?.translations ?? []
    if (translations.length !== texts.length) {
      throw new Error(
        `Translation returned ${translations.length} results for ${texts.length} inputs`,
      )
    }
    // An empty result for a non-empty input would silently blank a slide, so
    // fall back to the original text rather than erasing it.
    return translations.map((t, i) => t.translatedText ?? texts[i] ?? '')
  }
}

/**
 * Health probe for the footer badge: `disabled` without a key (the feature is
 * simply off, not broken), otherwise a cheap languages-list call that verifies
 * the key/API before reporting `ok`. Never throws — a failure reads as `down`.
 */
export const pingGoogleTranslation = async (): Promise<HealthComponent> => {
  if (!env.GOOGLE_CLOUD_TRANSLATION_KEY) {
    return { status: 'disabled', detail: 'no key' }
  }
  try {
    const res = await fetch(`${API_BASE}/languages?target=en`, {
      headers: { 'x-goog-api-key': env.GOOGLE_CLOUD_TRANSLATION_KEY },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
      ? { status: 'ok', detail: 'ready' }
      : { status: 'down', detail: `http ${res.status}` }
  } catch {
    return { status: 'down', detail: 'error' }
  }
}

registry.register(
  'translation',
  'google-cloud',
  () => new GoogleCloudTranslationProvider(),
)
