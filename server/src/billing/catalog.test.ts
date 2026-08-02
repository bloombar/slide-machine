/**
 * Unit tests for the plan catalog (BILL-1/BILL-6) — what the pricing page is
 * told about each plan.
 *
 * Two rules are worth holding onto. **Caps come from the plans file**, the one
 * named by PLANS_CONFIG_PATH, so a deployment that tunes an allowance sees the
 * new number on the page without a code change — the tests drive a config of
 * their own to prove nothing is baked in. **Prices come from the provider**,
 * which is what actually charges the card, and a provider that cannot answer
 * costs the page its figures, never its rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PlanPrice, PlansConfig } from '@slide-machine/shared'

/** A plans config the tests own, so the assertions are about this file rather
 * than about whatever the shipped config currently says. */
const plans = vi.hoisted(
  () =>
    ({
      free: {
        priceId: null,
        audioRetentionDays: 7,
        caps: { sttMinutes: 75, aiTokens: 5000, audienceLocales: 1 },
      },
      fresh: {
        priceId: 'price_fresh',
        audioRetentionDays: 14,
        caps: { sttMinutes: 150, aiTokens: 7500, audienceLocales: 2 },
      },
      pro: {
        priceId: 'price_pro',
        audioRetentionDays: 21,
        caps: { sttMinutes: 600, aiTokens: 65000, audienceLocales: 15 },
      },
      max: {
        priceId: null, // unpriced: configured, but not for sale here
        audioRetentionDays: null,
        caps: { sttMinutes: 3300, aiTokens: 100000, audienceLocales: 27 },
      },
    }) as unknown as PlansConfig,
)

vi.mock('../config/plans', () => ({ loadPlans: () => plans }))

const listPrices = vi.hoisted(() => vi.fn())

vi.mock('./registry', () => ({
  billingRegistry: { get: () => ({ name: 'test', listPrices }) },
}))

import { clearPriceCache, planCatalog } from './catalog'

const price = (amountMinor: number): PlanPrice => ({
  amountMinor,
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
})

beforeEach(() => {
  clearPriceCache()
  listPrices.mockReset()
  listPrices.mockResolvedValue({
    price_fresh: price(900),
    price_pro: price(2900),
  })
})

describe('planCatalog', () => {
  it('lists every tier, cheapest first', async () => {
    const catalog = await planCatalog()

    expect(catalog.plans.map(p => p.tier)).toEqual([
      'free',
      'fresh',
      'pro',
      'max',
    ])
  })

  it('takes the caps from the plans config rather than from code', async () => {
    const catalog = await planCatalog()

    // The numbers are this test's config, not the shipped one: nothing in the
    // catalog may hard-code an allowance the file is meant to own (BILL-6).
    expect(catalog.plans.map(p => p.caps.sttMinutes)).toEqual([
      75, 150, 600, 3300,
    ])
    expect(catalog.plans.map(p => p.audioRetentionDays)).toEqual([
      7,
      14,
      21,
      null,
    ])
  })

  it('rows the metered resources the config actually defines', async () => {
    const catalog = await planCatalog()

    // Instructor allowances first, then the audience's, so a cap and the
    // meter that spends it are read in the same order (BILL-3/BILL-4).
    expect(catalog.metrics.map(m => m.metric)).toEqual([
      'sttMinutes',
      'aiTokens',
      'audienceLocales',
    ])
    expect(catalog.metrics.map(m => m.allowance)).toEqual([
      'instructor',
      'instructor',
      'audience',
    ])
    // And each row says how its numbers read, so the page formats without
    // knowing any metric by name.
    expect(catalog.metrics[0]!.unit).toBe('minutes')
  })

  it('quotes the provider’s price for each tier that has one', async () => {
    const catalog = await planCatalog()

    expect(listPrices).toHaveBeenCalledWith(['price_fresh', 'price_pro'])
    expect(catalog.plans.map(p => p.price?.amountMinor ?? null)).toEqual([
      null,
      900,
      2900,
      null,
    ])
  })

  it('sells only the tiers the deployment has priced', async () => {
    const catalog = await planCatalog()

    // An unpriced tier has no checkout to start, so it is not offered rather
    // than failing at the point of purchase (BILL-6).
    expect(catalog.plans.map(p => p.purchasable)).toEqual([
      false,
      true,
      true,
      false,
    ])
  })

  it('still describes every plan when the provider cannot be reached', async () => {
    listPrices.mockRejectedValue(new Error('stripe is down'))

    const catalog = await planCatalog()

    // No figures, but every row: a page that cannot quote a price is far
    // better than a page that will not load.
    expect(catalog.plans).toHaveLength(4)
    expect(catalog.plans.every(p => p.price === null)).toBe(true)
    expect(catalog.metrics).not.toHaveLength(0)
  })

  it('leaves a tier unpriced when the provider does not know its price', async () => {
    listPrices.mockResolvedValue({ price_fresh: price(900) })

    const catalog = await planCatalog()

    // Still purchasable — the price id exists and checkout will use it; only
    // the figure is missing, and a guess would be worse than a blank.
    const pro = catalog.plans.find(p => p.tier === 'pro')!
    expect(pro.price).toBeNull()
    expect(pro.purchasable).toBe(true)
  })

  it('reuses prices for a while rather than asking on every page load', async () => {
    const start = 1_000_000
    await planCatalog(start)
    await planCatalog(start + 60_000)

    expect(listPrices).toHaveBeenCalledTimes(1)
  })

  it('asks again once the cached prices are stale', async () => {
    const start = 1_000_000
    await planCatalog(start)
    // Long enough that a price changed since would be a stale quote.
    await planCatalog(start + 10 * 60_000)

    expect(listPrices).toHaveBeenCalledTimes(2)
  })
})
