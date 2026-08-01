/**
 * Loads and validates the per-unit vendor prices from config/service-prices.json
 * (SPEC BILL-6/BILL-7). These are the numbers the plan caps were derived from
 * (docs/BILLING_COST_MODEL.md) and the ones cost accounting will price usage
 * with, so a vendor price change stays a configuration edit.
 *
 * Recorded cost is frozen when it is written, never recomputed from this file
 * — history must not re-price itself when a vendor changes its rates.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { env } from './env'

const price = z.number().nonnegative()

const servicePricesSchema = z.object({
  /** When these figures were last verified against the vendors' pricing. */
  asOf: z.string(),
  currency: z.string().default('USD'),
  ai: z.object({
    inputPerMillionTokens: price,
    outputPerMillionTokens: price,
    embeddingPerMillionTokens: price,
  }),
  stt: z.object({
    streamingPerMinute: price,
    batchPerMinute: price,
  }),
  tts: z.object({
    standardPerMillionChars: price,
    premiumPerMillionChars: price,
  }),
  translation: z.object({
    perMillionChars: price,
    /** Allowance the vendor grants per account, not per user — headroom that
     * disappears with scale, so caps are sized against the marginal price. */
    freeCharsPerMonth: price.default(0),
  }),
  images: z.object({ generatedPerImage: price }),
  storage: z.object({ perGibMonth: price, egressPerGib: price }),
  payments: z.object({
    rate: price,
    perTransaction: price,
    billingRate: price.default(0),
  }),
})

export type ServicePrices = z.infer<typeof servicePricesSchema>

/** Reads and validates the service prices from the given path. */
export const loadServicePrices = (
  configPath: string = env.SERVICE_PRICES_PATH,
): ServicePrices => {
  const raw = readFileSync(configPath, 'utf8')
  return servicePricesSchema.parse(JSON.parse(raw))
}
