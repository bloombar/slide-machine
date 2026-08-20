/**
 * The per-unit vendor prices the deployment's *current* configuration can
 * actually incur (SPEC BILL-6/BILL-7): the price list from
 * config/service-prices.json filtered down to the providers, models, and
 * voices that are switched on right now. A rate for a provider that is
 * disabled — or mocked, or replaced by a free engine — is a fact about the
 * vendor, not about this deployment, and showing it would read as spend that
 * can happen when it cannot.
 *
 * Rebuilt on every call: the price file is re-read and the gates re-check the
 * active configuration, so an operator who edits the file sees the new rates
 * on the next refresh without a restart. (The metering path deliberately does
 * not work this way — recorded cost is frozen when written.)
 */
import type {
  ConfiguredPrice,
  ServicePricesResponse,
} from '@slide-machine/shared'
import { env } from '../config/env'
import {
  loadServicePrices,
  tokenPriceFor,
  type ServicePrices,
} from '../config/service-prices'

/** The configuration facts the gates read — injectable so tests can flip
 * providers without re-parsing the process environment. */
export type PriceGates = Pick<
  typeof env,
  | 'GENERATION_PROVIDER'
  | 'QUIZ_PROVIDER'
  | 'GEMINI_MODEL'
  | 'GEMINI_EMBED_MODEL'
  | 'TRANSCRIPTION_PROVIDER'
  | 'DIARIZATION_PROVIDER'
  | 'TTS_PROVIDER'
  | 'GOOGLE_CLOUD_TTS_KEY'
  | 'TRANSLATION_PROVIDER'
  | 'GOOGLE_CLOUD_TRANSLATION_KEY'
  | 'STORAGE_PROVIDER'
  | 'BILLING_PROVIDER'
>

const count = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value)

/** "First N a month are free", or nothing when there is no allowance. */
const freeNote = (amount: number, unit: string): string | undefined =>
  amount > 0 ? `First ${count(amount)} ${unit} each month are free` : undefined

/** Gemini text + embedding rates, when generation or quizzes use Gemini. */
const aiLines = (
  gates: PriceGates,
  prices: ServicePrices,
): ConfiguredPrice[] => {
  if (
    gates.GENERATION_PROVIDER !== 'gemini' &&
    gates.QUIZ_PROVIDER !== 'gemini'
  )
    return []
  const lines: ConfiguredPrice[] = []
  // The same fallback the metering path applies: an unlisted model is priced
  // as the price list's default, so that is the entry actually in use.
  const model = prices.ai.models[gates.GEMINI_MODEL]
    ? gates.GEMINI_MODEL
    : prices.ai.defaultModel
  const tokens = tokenPriceFor(prices, gates.GEMINI_MODEL)
  if (tokens) {
    lines.push(
      {
        service: 'AI generation',
        detail: model,
        unit: 'per 1M input tokens',
        rate: tokens.inputPerMillionTokens,
        kind: 'currency',
      },
      {
        service: 'AI generation',
        detail: model,
        unit: 'per 1M output tokens',
        rate: tokens.outputPerMillionTokens,
        kind: 'currency',
      },
    )
    if (tokens.audioInputPerMillionTokens !== undefined) {
      lines.push({
        service: 'AI generation',
        detail: model,
        unit: 'per 1M audio input tokens',
        rate: tokens.audioInputPerMillionTokens,
        kind: 'currency',
      })
    }
  }
  const embedding = prices.ai.embeddingModels[gates.GEMINI_EMBED_MODEL]
  if (embedding) {
    lines.push({
      service: 'Embeddings',
      detail: gates.GEMINI_EMBED_MODEL,
      unit: 'per 1M input tokens',
      rate: embedding.inputPerMillionTokens,
      kind: 'currency',
    })
  }
  return lines
}

/** Narration voices, when Cloud TTS is both selected and keyed — an absent
 * key disables the feature everywhere it appears. */
const narrationLines = (
  gates: PriceGates,
  prices: ServicePrices,
): ConfiguredPrice[] => {
  if (gates.TTS_PROVIDER !== 'google-cloud' || !gates.GOOGLE_CLOUD_TTS_KEY)
    return []
  const roles: [string, string][] = [
    ['standard voices', prices.tts.defaultStandardFamily],
    ['premium voices', prices.tts.defaultPremiumFamily],
  ]
  // One configured family serving both roles is one price, not two rows.
  const seen = new Set<string>()
  const lines: ConfiguredPrice[] = []
  for (const [role, familyName] of roles) {
    const family = prices.tts.voiceFamilies[familyName]
    if (!family || seen.has(familyName)) continue
    seen.add(familyName)
    lines.push({
      service: 'Narration',
      detail: `${role} (${familyName})`,
      unit: 'per 1M characters',
      rate: family.perMillionChars,
      kind: 'currency',
      note: freeNote(family.freeCharsPerMonth, 'characters'),
    })
  }
  return lines
}

/**
 * Builds the in-use price list. `configPath` overrides where the price file
 * is read from (tests); by default it is the deployment's configured file,
 * re-read on every call.
 */
export const configuredPrices = (
  gates: PriceGates = env,
  configPath?: string,
): ServicePricesResponse => {
  const prices = loadServicePrices(configPath)
  const lines: ConfiguredPrice[] = [...aiLines(gates, prices)]

  // Image generation has no adapter registered yet and nothing meters
  // `aiImages`, so its rates are never in use regardless of configuration.

  if (gates.TRANSCRIPTION_PROVIDER === 'google-cloud') {
    lines.push({
      service: 'Speech-to-text',
      detail: 'streaming recognition',
      unit: 'per minute',
      rate: prices.stt.recognitionPerMinute,
      kind: 'currency',
      note: freeNote(prices.stt.freeMinutesPerMonth, 'minutes'),
    })
  }
  if (gates.DIARIZATION_PROVIDER === 'google-cloud') {
    // Batch diarization bills under the same recognition SKU.
    lines.push({
      service: 'Speaker identification',
      detail: 'batch recognition',
      unit: 'per minute',
      rate: prices.stt.recognitionPerMinute,
      kind: 'currency',
    })
  }

  lines.push(...narrationLines(gates, prices))

  if (
    gates.TRANSLATION_PROVIDER === 'google-cloud' &&
    gates.GOOGLE_CLOUD_TRANSLATION_KEY
  ) {
    lines.push({
      service: 'Translation',
      unit: 'per 1M characters',
      rate: prices.translation.perMillionChars,
      kind: 'currency',
      note: freeNote(prices.translation.freeCharsPerMonth, 'characters'),
    })
  }

  // The local-disk provider stores for free; only object storage is billed.
  if (gates.STORAGE_PROVIDER === 's3') {
    lines.push(
      {
        service: 'File storage',
        detail: 'object storage',
        unit: 'per GiB-month',
        rate: prices.storage.perGibMonth,
        kind: 'currency',
      },
      {
        service: 'File storage',
        detail: 'egress',
        unit: 'per GiB downloaded',
        rate: prices.storage.egressPerGib,
        kind: 'currency',
      },
    )
  }

  if (gates.BILLING_PROVIDER === 'stripe') {
    lines.push(
      {
        service: 'Payments',
        detail: 'card processing',
        unit: 'of each charge',
        rate: prices.payments.rate,
        kind: 'percent',
      },
      {
        service: 'Payments',
        detail: 'card processing',
        unit: 'per successful charge',
        rate: prices.payments.perTransaction,
        kind: 'currency',
      },
    )
    if (prices.payments.billingRate > 0) {
      lines.push({
        service: 'Payments',
        detail: 'billing',
        unit: 'of subscription volume',
        rate: prices.payments.billingRate,
        kind: 'percent',
      })
    }
  }

  return { asOf: prices.asOf, currency: prices.currency, prices: lines }
}
