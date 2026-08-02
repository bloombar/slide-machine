/**
 * Every plan side by side, as the plan-pricing page reads them (SPEC
 * BILL-1/BILL-6).
 *
 * Two sources, each for what it is the record of. **Caps, features, and the
 * retention policy come from the plans config** — the file named by
 * `PLANS_CONFIG_PATH` (TECH-4) — so tuning allowances stays a config change
 * and nothing here hard-codes a number the file is supposed to own. **Prices
 * come from the billing provider**, which is what actually charges the card
 * (BILL-2): quoting a figure copied into our own config would let the page
 * advertise one price while checkout billed another.
 *
 * Nothing here reads an account. The answer is the same for everyone, and who
 * is on which plan is the billing summary's business.
 *
 * The rows are ordered by the same rules the usage panel uses, so a cap and
 * the meter that spends it never appear in two different sequences.
 */
import {
  PLAN_FEATURES,
  PLAN_TIERS,
  type PlanCapRow,
  type PlanCatalog,
  type PlanCatalogEntry,
  type PlanCaps,
  type PlanPrice,
  type PlanTier,
  type UsageMetric,
} from '@slide-machine/shared'
import { loadPlans } from '../config/plans'
import { billingRegistry } from './registry'
import { allowanceOf, byDisplayOrder, unitOf } from './usage-view'

/**
 * How long a price read from the provider is reused. Prices change about as
 * often as a company changes its mind about pricing, so a page load does not
 * need to ask again — but the window is short enough that a change is live the
 * same hour it is made, without a deploy.
 */
const PRICE_TTL_MS = 5 * 60 * 1000

let cache: { at: number; prices: Record<string, PlanPrice> } | null = null

/** Drops the memoized prices. For tests, and for anything that changes which
 * provider is registered. */
export const clearPriceCache = (): void => {
  cache = null
}

/**
 * What the provider charges for each given price id. A provider that is
 * unconfigured, unreachable, or simply does not know an id yields no figure
 * for it: the table then shows the plan without a price, which is a smaller
 * failure than a pricing page that will not load at all.
 */
const pricesFor = async (
  priceIds: string[],
  now: number,
): Promise<Record<string, PlanPrice>> => {
  if (!priceIds.length) return {}
  if (cache && now - cache.at < PRICE_TTL_MS) return cache.prices

  let prices: Record<string, PlanPrice> = {}
  try {
    prices = await billingRegistry.get().listPrices(priceIds)
  } catch (error) {
    console.warn('Could not read plan prices:', (error as Error).message)
  }
  cache = { at: now, prices }
  return prices
}

/** The metered rows, discovered from the config rather than listed here: a cap
 * added to plans.json shows up in the table without an edit, and one removed
 * stops being advertised. */
const capRows = (caps: PlanCaps): PlanCapRow[] =>
  (Object.keys(caps) as UsageMetric[]).sort(byDisplayOrder).map(metric => ({
    metric,
    allowance: allowanceOf(metric),
    unit: unitOf(metric),
  }))

/**
 * Every plan's price, caps, features, and retention policy, cheapest first.
 *
 * `purchasable` is the same rule checkout enforces (BILL-6) — a tier without a
 * price id is not for sale — so the page never offers a button that would fail
 * at the point of purchase.
 */
export const planCatalog = async (
  now: number = Date.now(),
): Promise<PlanCatalog> => {
  const plans = loadPlans()
  const tiers: PlanTier[] = [...PLAN_TIERS]
  const priceIds = tiers
    .map(tier => plans[tier].priceId)
    .filter((id): id is string => Boolean(id))
  const prices = await pricesFor(priceIds, now)

  const entries: PlanCatalogEntry[] = tiers.map(tier => {
    const plan = plans[tier]
    return {
      tier,
      purchasable: Boolean(plan.priceId),
      // The free tier has nothing to charge for, and a paid tier whose price
      // the provider could not state is shown without one.
      price: (plan.priceId && prices[plan.priceId]) || null,
      // Every tier offers every capability today (BILL-1); this is reported
      // per tier rather than assumed so the shape can express it if that
      // ever stops being true.
      features: [...PLAN_FEATURES],
      caps: plan.caps,
      audioRetentionDays: plan.audioRetentionDays,
    }
  })

  return { metrics: capRows(plans.free.caps), plans: entries }
}
