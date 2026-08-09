/**
 * What a metered event actually cost (SPEC BILL-6/BILL-7).
 *
 * Every rate comes from `config/service-prices.json`, so a vendor changing its
 * prices is a configuration edit rather than a deployment. The number this
 * produces is then **frozen onto the ledger row**: history must never re-price
 * itself when a rate changes, or last quarter's report would quietly become a
 * different report.
 *
 * **Micros, not cents.** A thousand AI tokens costs a fraction of a penny, and
 * a ledger denominated in cents would record almost every event in the product
 * as costing zero — then sum a million of them to nothing. One micro is a
 * millionth of a currency unit, which keeps a single token's cost an integer
 * with room to spare, and integers keep the arithmetic exact.
 *
 * **A metric is not always enough to price by.** `aiTokens` is input plus
 * output, and those bill at different rates; narration is priced per voice
 * family. Where the caller knows more than the metric does it passes a
 * `PricingHint`, and where it does not this falls back to the deployment's
 * configured default model or voice — which is what the adapter would have
 * used anyway.
 */
import type { UsageMetric } from '@slide-machine/shared'
import {
  loadServicePrices,
  tokenPriceFor,
  type ServicePrices,
} from '../config/service-prices'

/** A millionth of a currency unit. */
export const MICROS_PER_UNIT = 1_000_000

/**
 * What the caller knows that the metric's own number does not.
 *
 * Deliberately narrow: this exists to price accurately, not to become a second
 * description of the work. Anything absent falls back to the configured
 * default, so an adapter that reports nothing still produces a defensible
 * figure rather than a zero.
 */
export type PricingHint =
  | {
      kind: 'tokens'
      /** Prompt tokens, billed at the input rate. */
      inputTokens?: number
      /** Completion and thinking tokens, both billed at the output rate. */
      outputTokens?: number
      /** Which model, when it is not the deployment's default. */
      model?: string
    }
  | { kind: 'voice'; family?: string }
  | { kind: 'image'; model?: string }

/** Prices are read once: the file is deploy-time configuration, and pricing
 * runs on every metered event. */
let prices: ServicePrices | undefined
const servicePrices = (): ServicePrices => (prices ??= loadServicePrices())

/** Test seam: drops the cached prices so a spec can point at another file. */
export const resetPriceCache = (): void => {
  prices = undefined
}

/** The currency every figure on the ledger is denominated in. */
export const ledgerCurrency = (): string => servicePrices().currency

/** Rounds to whole micros. Costs are summed by the million, so a consistent
 * rounding rule matters more than which one it is. */
const micros = (units: number): number => Math.round(units * MICROS_PER_UNIT)

/** Cost of `quantity` at a per-million rate. */
const perMillion = (quantity: number, rate: number): number =>
  micros((quantity / 1_000_000) * rate)

/**
 * AI tokens, split by rate where the caller knows the split.
 *
 * Without a hint the whole quantity is priced at the **output** rate. That
 * overstates a token-heavy prompt rather than understating it, which is the
 * right direction for a number an operator uses to decide what the deployment
 * costs — a cost report that flatters is worse than one that does not.
 */
const priceTokens = (quantity: number, hint?: PricingHint): number => {
  const config = servicePrices()
  const model = hint?.kind === 'tokens' ? hint.model : undefined
  const rate = tokenPriceFor(config, model ?? config.ai.defaultModel)
  if (!rate) return 0
  if (hint?.kind === 'tokens' && (hint.inputTokens || hint.outputTokens)) {
    return (
      perMillion(hint.inputTokens ?? 0, rate.inputPerMillionTokens) +
      perMillion(hint.outputTokens ?? 0, rate.outputPerMillionTokens)
    )
  }
  return perMillion(quantity, rate.outputPerMillionTokens)
}

/** Narration characters at the family's rate, defaulting to the configured
 * standard or premium family for the metric. */
const priceVoice = (
  quantity: number,
  premium: boolean,
  hint?: PricingHint,
): number => {
  const { tts } = servicePrices()
  const name =
    (hint?.kind === 'voice' ? hint.family : undefined) ??
    (premium ? tts.defaultPremiumFamily : tts.defaultStandardFamily)
  const family = tts.voiceFamilies[name]
  if (!family) return 0
  return perMillion(quantity, family.perMillionChars)
}

/**
 * What one metered event cost, in micros of the configured currency.
 *
 * Returns 0 for anything the price list does not cover rather than throwing:
 * an unpriced service is a gap in a config file, and the honest response is a
 * ledger row that records the event with no money against it — not a failed
 * user request, and not an invented figure.
 */
export const costMicrosFor = (
  metric: UsageMetric,
  quantity: number,
  hint?: PricingHint,
): number => {
  if (quantity <= 0) return 0
  const config = servicePrices()
  switch (metric) {
    case 'aiTokens':
      return priceTokens(quantity, hint)
    case 'sttMinutes':
      return micros(quantity * config.stt.recognitionPerMinute)
    case 'diarizationMinutes':
      // Batch diarization bills at the same recognition rate; the separate
      // metric exists because the caps differ, not because the price does.
      return micros(quantity * config.stt.recognitionPerMinute)
    case 'ttsCharacters':
      return priceVoice(quantity, false, hint)
    case 'ttsPremiumCharacters':
      return priceVoice(quantity, true, hint)
    case 'audienceTtsCharacters':
      // Charged to the owner from a separate allowance, but synthesized by the
      // same voices at the same rate. Which pool paid is a fact about the
      // plan; what it cost us is a fact about the vendor.
      return priceVoice(quantity, false, hint)
    case 'translationCharacters':
      return perMillion(quantity, config.translation.perMillionChars)
    case 'audienceLocales':
      // Counted in whole languages for the allowance's sake (BILL-3), so the
      // characters behind it are priced on the `translationCharacters` event
      // that accompanies the same work. Pricing this too would double-count.
      return 0
    case 'aiImages': {
      const model =
        (hint?.kind === 'image' ? hint.model : undefined) ??
        Object.keys(config.ai.imageModels)[0]
      const priced = model ? config.ai.imageModels[model] : undefined
      return priced ? micros(quantity * priced.perImage) : 0
    }
    case 'audioStorageMb':
      // A gauge, and a monthly rate: what this holds costs money for as long
      // as it is held, which is a roll-up question rather than an event one.
      // Charged by the retention sweep's accounting, not per write.
      return 0
    case 'imageLookups':
    case 'importMb':
    case 'exports':
      // Metered because they bound abuse and shape the plans, not because a
      // vendor invoices for them. A row at zero still records that they
      // happened, which is what the activity counts are built from.
      return 0
    default:
      return 0
  }
}
