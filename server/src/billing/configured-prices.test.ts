/**
 * Unit tests for the in-use price list (BILL-7): only services the current
 * configuration can actually incur appear, the same model fallback the
 * metering path applies is applied here, and the file is re-read on every
 * call so a config edit shows without a restart.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configuredPrices, type PriceGates } from './configured-prices'

/** A config where every gated service has a distinct, spottable rate. */
const priceFile = {
  asOf: '2026-07-31',
  currency: 'USD',
  ai: {
    defaultModel: 'default-model',
    models: {
      'default-model': {
        inputPerMillionTokens: 0.3,
        outputPerMillionTokens: 2.5,
      },
      'audio-model': {
        inputPerMillionTokens: 0.5,
        outputPerMillionTokens: 3,
        audioInputPerMillionTokens: 1,
      },
    },
    embeddingModels: { 'embed-model': { inputPerMillionTokens: 0.15 } },
    imageModels: { 'image-model': { perImage: 0.039 } },
  },
  stt: {
    recognitionPerMinute: 0.016,
    dynamicBatchPerMinute: 0.003,
    freeMinutesPerMonth: 0,
    volumeTiers: [],
  },
  tts: {
    defaultStandardFamily: 'neural2',
    defaultPremiumFamily: 'chirp3-hd',
    voiceFamilies: {
      neural2: { perMillionChars: 16, freeCharsPerMonth: 1_000_000 },
      'chirp3-hd': { perMillionChars: 30, freeCharsPerMonth: 1_000_000 },
    },
  },
  translation: { perMillionChars: 20, freeCharsPerMonth: 500_000 },
  storage: { perGibMonth: 0.02, egressPerGib: 0.01 },
  payments: { rate: 0.029, perTransaction: 0.3, billingRate: 0.007 },
}

/** Everything switched on. Individual tests switch things off from here. */
const allOn: PriceGates = {
  GENERATION_PROVIDER: 'gemini',
  QUIZ_PROVIDER: 'gemini',
  GEMINI_MODEL: 'default-model',
  GEMINI_EMBED_MODEL: 'embed-model',
  TRANSCRIPTION_PROVIDER: 'google-cloud',
  DIARIZATION_PROVIDER: 'google-cloud',
  TTS_PROVIDER: 'google-cloud',
  GOOGLE_CLOUD_TTS_KEY: 'tts-key',
  TRANSLATION_PROVIDER: 'google-cloud',
  GOOGLE_CLOUD_TRANSLATION_KEY: 'translation-key',
  STORAGE_PROVIDER: 's3',
  BILLING_PROVIDER: 'stripe',
}

let dir: string
let file: string

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'service-prices-'))
  file = path.join(dir, 'service-prices.json')
  writeFileSync(file, JSON.stringify(priceFile))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const build = (over: Partial<PriceGates> = {}) =>
  configuredPrices({ ...allOn, ...over }, file)

const services = (over: Partial<PriceGates> = {}) =>
  new Set(build(over).prices.map(line => line.service))

describe('configuredPrices', () => {
  it('lists every service the configuration engages, with its rate', () => {
    const body = build()
    expect(body.asOf).toBe('2026-07-31')
    expect(body.currency).toBe('USD')
    expect(services()).toEqual(
      new Set([
        'AI generation',
        'Embeddings',
        'Speech-to-text',
        'Speaker identification',
        'Narration',
        'Translation',
        'File storage',
        'Payments',
      ]),
    )
    const input = body.prices.find(
      line =>
        line.service === 'AI generation' && line.unit === 'per 1M input tokens',
    )
    expect(input).toMatchObject({
      rate: 0.3,
      kind: 'currency',
      detail: 'default-model',
    })
  })

  it('never lists image generation — no adapter exists to incur it', () => {
    expect(services()).not.toContain('Image generation')
  })

  it('drops AI lines when neither generation nor quizzes use Gemini', () => {
    const on = services({ GENERATION_PROVIDER: 'mock', QUIZ_PROVIDER: 'mock' })
    expect(on.has('AI generation')).toBe(false)
    expect(on.has('Embeddings')).toBe(false)
    // Quizzes alone keep the model in use.
    expect(services({ GENERATION_PROVIDER: 'mock' }).has('AI generation')).toBe(
      true,
    )
  })

  it('prices an unlisted model as the default entry, like metering does', () => {
    const lines = build({ GEMINI_MODEL: 'not-in-the-price-list' }).prices
    const input = lines.find(line => line.unit === 'per 1M input tokens')
    expect(input).toMatchObject({ detail: 'default-model', rate: 0.3 })
  })

  it('includes an audio input rate only when the model bills one', () => {
    expect(
      build().prices.some(line => line.unit === 'per 1M audio input tokens'),
    ).toBe(false)
    const audio = build({ GEMINI_MODEL: 'audio-model' }).prices.find(
      line => line.unit === 'per 1M audio input tokens',
    )
    expect(audio).toMatchObject({ rate: 1 })
  })

  it('treats browser speech recognition as free', () => {
    expect(
      services({ TRANSCRIPTION_PROVIDER: 'browser' }).has('Speech-to-text'),
    ).toBe(false)
    expect(
      services({ DIARIZATION_PROVIDER: 'none' }).has('Speaker identification'),
    ).toBe(false)
  })

  it('shows both narration voice roles with their free allowances', () => {
    const narration = build().prices.filter(
      line => line.service === 'Narration',
    )
    expect(narration).toHaveLength(2)
    expect(narration[0]).toMatchObject({
      detail: 'standard voices (neural2)',
      rate: 16,
      note: 'First 1,000,000 characters each month are free',
    })
    expect(narration[1]!.detail).toBe('premium voices (chirp3-hd)')
  })

  it('drops narration when the TTS key is absent — the feature is off', () => {
    expect(services({ GOOGLE_CLOUD_TTS_KEY: undefined }).has('Narration')).toBe(
      false,
    )
    expect(services({ TTS_PROVIDER: 'mock' }).has('Narration')).toBe(false)
  })

  it('drops translation without its provider or key', () => {
    expect(services({ TRANSLATION_PROVIDER: 'none' }).has('Translation')).toBe(
      false,
    )
    expect(
      services({ GOOGLE_CLOUD_TRANSLATION_KEY: undefined }).has('Translation'),
    ).toBe(false)
  })

  it('treats local-disk storage as free, object storage as billed', () => {
    expect(services({ STORAGE_PROVIDER: 'local' }).has('File storage')).toBe(
      false,
    )
    const storage = build().prices.filter(
      line => line.service === 'File storage',
    )
    expect(storage.map(line => line.rate)).toEqual([0.02, 0.01])
  })

  it('shows payment fees only under a real billing provider', () => {
    expect(services({ BILLING_PROVIDER: 'mock' }).has('Payments')).toBe(false)
    const payments = build().prices.filter(line => line.service === 'Payments')
    expect(payments.map(line => line.kind)).toEqual([
      'percent',
      'currency',
      'percent',
    ])
  })

  it('re-reads the file on every call, so an edit shows without a restart', () => {
    expect(
      build().prices.find(line => line.service === 'Translation')!.rate,
    ).toBe(20)
    const edited = {
      ...priceFile,
      translation: { ...priceFile.translation, perMillionChars: 25 },
    }
    writeFileSync(file, JSON.stringify(edited))
    expect(
      build().prices.find(line => line.service === 'Translation')!.rate,
    ).toBe(25)
    writeFileSync(file, JSON.stringify(priceFile))
  })
})
