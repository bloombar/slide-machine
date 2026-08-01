/**
 * Loads and validates the per-unit vendor prices from config/service-prices.json
 * (SPEC BILL-6/BILL-7). These are the numbers the plan caps were derived from
 * (docs/BILLING_COST_MODEL.md) and the ones cost accounting will price usage
 * with, so a vendor price change stays a configuration edit.
 *
 * Prices are keyed by **model / voice family**, not by capability, so switching
 * `GEMINI_MODEL` or a narration voice is a config change on both sides — the
 * adapter picks the model, this file already knows what it costs.
 *
 * Recorded cost is frozen when it is written, never recomputed from this file
 * — history must not re-price itself when a vendor changes its rates.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { env } from './env'

const price = z.number().nonnegative()

const tokenPriceSchema = z.object({
  inputPerMillionTokens: price,
  outputPerMillionTokens: price,
  /** Audio input is billed at a higher rate by some models. */
  audioInputPerMillionTokens: price.optional(),
})

const servicePricesSchema = z.object({
  /** When these figures were last verified against the vendors' pricing. */
  asOf: z.string(),
  currency: z.string().default('USD'),
  ai: z.object({
    /** Matches `GEMINI_MODEL`; the entry callers price against by default. */
    defaultModel: z.string(),
    models: z.record(z.string(), tokenPriceSchema),
    embeddingModels: z.record(
      z.string(),
      z.object({ inputPerMillionTokens: price }),
    ),
    imageModels: z.record(z.string(), z.object({ perImage: price })),
  }),
  stt: z.object({
    /** Streaming *and* standard batch both bill under this rate. */
    recognitionPerMinute: price,
    /** Opt-in mode with up to 24 h turnaround — 5× cheaper. */
    dynamicBatchPerMinute: price,
    /** V2 has no free tier; the 60 free minutes are a V1-only SKU. */
    freeMinutesPerMonth: price.default(0),
    volumeTiers: z
      .array(z.object({ fromMinutesPerMonth: price, perMinute: price }))
      .default([]),
  }),
  tts: z.object({
    /** Characters of input, SSML tags included except `<mark>`. Recorded
     * because the Gemini-TTS models below bill in tokens instead — switching
     * to one changes the metric's unit, not just its rate. */
    billingUnit: z.string().default('characters-including-ssml-except-mark'),
    defaultStandardFamily: z.string(),
    defaultPremiumFamily: z.string(),
    geminiTtsModels: z
      .record(
        z.string(),
        z.object({
          inputPerMillionTextTokens: price,
          outputPerMillionAudioTokens: price,
          audioTokensPerSecond: price,
        }),
      )
      .default({}),
    voiceFamilies: z.record(
      z.string(),
      z.object({
        perMillionChars: price,
        /** Per account per month, not per user — headroom, not budget. */
        freeCharsPerMonth: price.default(0),
      }),
    ),
  }),
  translation: z.object({
    perMillionChars: price,
    freeCharsPerMonth: price.default(0),
  }),
  storage: z.object({ perGibMonth: price, egressPerGib: price }),
  payments: z.object({
    rate: price,
    perTransaction: price,
    billingRate: price.default(0),
  }),
})

export type ServicePrices = z.infer<typeof servicePricesSchema>
export type TokenPrice = z.infer<typeof tokenPriceSchema>

/** Reads and validates the service prices from the given path. */
export const loadServicePrices = (
  configPath: string = env.SERVICE_PRICES_PATH,
): ServicePrices => {
  const raw = readFileSync(configPath, 'utf8')
  return servicePricesSchema.parse(JSON.parse(raw))
}

/**
 * Token prices for a model name, falling back to the configured default so an
 * unlisted or newly-switched model still prices rather than throwing mid-call.
 * Returns null only when the default itself is missing, which is a config bug.
 */
export const tokenPriceFor = (
  prices: ServicePrices,
  model: string,
): TokenPrice | null =>
  prices.ai.models[model] ?? prices.ai.models[prices.ai.defaultModel] ?? null
