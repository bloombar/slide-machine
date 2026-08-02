/**
 * Unit tests for the parts of subscription state that need no database.
 *
 * Which tiers are for sale is read straight from the plan config (BILL-6), so
 * a deployment that has not finished setting its price ids offers fewer tiers
 * rather than sending someone to a checkout that cannot be built. The rest of
 * this module is inseparable from persistence and is covered end-to-end in
 * test/integration/billing.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'
import type { PlanCaps, PlansConfig } from '@slide-machine/shared'

const caps = {} as PlanCaps
const plans: PlansConfig = {
  free: { priceId: null, caps, audioRetentionDays: 7 },
  fresh: { priceId: 'price_fresh', caps, audioRetentionDays: 14 },
  // Priced but not yet configured — the state a half-finished deployment is
  // in, and the reason this is read rather than hard-coded.
  pro: { priceId: null, caps, audioRetentionDays: 21 },
  max: { priceId: 'price_max', caps, audioRetentionDays: null },
}
vi.mock('../config/plans', () => ({ loadPlans: () => plans }))

import { purchasableTiers } from './subscription'

describe('purchasableTiers', () => {
  it('offers only the tiers that have a price', () => {
    expect(purchasableTiers()).toEqual(['fresh', 'max'])
  })

  it('never offers the free tier, which has nothing to buy', () => {
    expect(purchasableTiers()).not.toContain('free')
  })
})
