/**
 * Unit tests for the mock billing adapter: it must satisfy the whole
 * BillingProvider contract deterministically and offline, since dev and e2e
 * runs drive real application logic through it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SubscriptionSnapshot } from '@slide-machine/shared'

const testEnv = vi.hoisted(() => ({
  BILLING_PROVIDER: 'mock',
  // The real plans file: the mock prices whatever price ids it names.
  PLANS_CONFIG_PATH: new URL('../../../config/plans.json', import.meta.url)
    .pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { MockBillingProvider } from './mock'
import { loadPlans } from '../config/plans'
import { billingRegistry } from './registry'
import { WebhookVerificationError } from './errors'

const checkout = {
  userId: 'user-1',
  email: 'author@example.edu',
  tier: 'pro' as const,
  successUrl: 'https://app.test/billing/done',
  cancelUrl: 'https://app.test/billing',
}

let provider: MockBillingProvider

beforeEach(() => {
  provider = new MockBillingProvider()
})

describe('registration', () => {
  it('is the adapter the registry resolves for BILLING_PROVIDER=mock', () => {
    expect(billingRegistry.get()).toBeInstanceOf(MockBillingProvider)
  })
})

describe('MockBillingProvider.createCheckoutSession', () => {
  it('returns a session that lands back on the success url', async () => {
    const session = await provider.createCheckoutSession(checkout)

    expect(session.providerSessionId).toBe('mock_cs_1')
    expect(session.url).toBe(
      'https://app.test/billing/done?session_id=mock_cs_1',
    )
  })

  it('appends to a success url that already carries query parameters', async () => {
    const session = await provider.createCheckoutSession({
      ...checkout,
      successUrl: 'https://app.test/billing/done?from=upgrade',
    })

    expect(session.url).toContain('?from=upgrade&session_id=')
  })

  it('remembers which account the checkout was for', async () => {
    await provider.createCheckoutSession(checkout)

    // The real adapters carry this in provider metadata; the mock keeps it so
    // a webhook driven through it attributes to somebody, as Stripe's would.
    const changed = await provider.changeTier({
      providerSubscriptionId: 'mock_sub_2',
      tier: 'max',
    })
    expect(changed.userId).toBe('user-1')
  })

  it('reuses a known customer reference instead of minting one', async () => {
    await provider.createCheckoutSession({
      ...checkout,
      billingCustomerId: 'cus_existing',
    })
    const changed = await provider.changeTier({
      providerSubscriptionId: 'mock_sub_2',
      tier: 'max',
    })

    expect(changed.billingCustomerId).toBe('cus_existing')
  })
})

describe('MockBillingProvider.changeTier', () => {
  it('moves an issued subscription to the new tier', async () => {
    await provider.createCheckoutSession(checkout)

    const changed = await provider.changeTier({
      providerSubscriptionId: 'mock_sub_2',
      tier: 'max',
    })

    expect(changed).toMatchObject({
      providerSubscriptionId: 'mock_sub_2',
      tier: 'max',
      status: 'active',
    })
  })

  it('synthesizes a subscription it never issued, so restarts do not break dev', async () => {
    const changed = await provider.changeTier({
      providerSubscriptionId: 'sub_from_last_process',
      tier: 'max',
    })

    expect(changed.tier).toBe('max')
    expect(changed.status).toBe('active')
  })
})

describe('MockBillingProvider.createPortalSession', () => {
  it('returns a url back to the caller-supplied return page', async () => {
    const session = await provider.createPortalSession({
      billingCustomerId: 'cus_1',
      returnUrl: 'https://app.test/settings',
    })

    expect(session.url).toBe('https://app.test/settings?mock_portal=cus_1')
  })
})

describe('MockBillingProvider.listPrices', () => {
  it('quotes a monthly price for each paid tier, rising with the tier', async () => {
    const plans = loadPlans()
    const ids = [plans.fresh.priceId!, plans.pro.priceId!, plans.max.priceId!]

    const prices = await provider.listPrices(ids)

    expect(prices[ids[0]!]).toEqual({
      amountMinor: 900,
      currency: 'usd',
      interval: 'month',
      intervalCount: 1,
    })
    expect(ids.map(id => prices[id]!.amountMinor)).toEqual([900, 2900, 9900])
  })

  it('says nothing about a price id it never issued', async () => {
    // The contract is to omit what it does not know, not to invent a figure.
    expect(await provider.listPrices(['price_not_ours'])).toEqual({})
  })
})

describe('MockBillingProvider.cancelSubscription', () => {
  it('defaults to cancelling at period end, leaving access active', async () => {
    await provider.createCheckoutSession(checkout)

    const canceled = await provider.cancelSubscription({
      providerSubscriptionId: 'mock_sub_2',
    })

    expect(canceled).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
    })
  })

  it('cancels immediately when asked', async () => {
    await provider.createCheckoutSession(checkout)

    const canceled = await provider.cancelSubscription({
      providerSubscriptionId: 'mock_sub_2',
      atPeriodEnd: false,
    })

    expect(canceled).toMatchObject({
      status: 'canceled',
      cancelAtPeriodEnd: false,
    })
  })
})

describe('MockBillingProvider.parseWebhook', () => {
  const subscription: SubscriptionSnapshot = {
    providerSubscriptionId: 'mock_sub_9',
    billingCustomerId: 'cus_9',
    tier: 'pro',
    status: 'past_due',
    currentPeriodStart: '2026-07-01T00:00:00.000Z',
    currentPeriodEnd: '2026-07-31T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  }

  it('normalizes an internal-shaped delivery', async () => {
    const event = await provider.parseWebhook({
      rawBody: JSON.stringify({
        type: 'subscription.past_due',
        providerEventId: 'evt_9',
        occurredAt: '2026-07-15T12:00:00.000Z',
        subscription,
      }),
      headers: {},
    })

    expect(event).toEqual({
      type: 'subscription.past_due',
      providerEventId: 'evt_9',
      occurredAt: '2026-07-15T12:00:00.000Z',
      subscription,
    })
  })

  it('fills in an event id and timestamp when the delivery omits them', async () => {
    const event = await provider.parseWebhook({
      rawBody: JSON.stringify({ type: 'subscription.active', subscription }),
      headers: {},
    })

    expect(event?.providerEventId).toMatch(/^mock_evt_/)
    expect(Date.parse(event?.occurredAt ?? '')).not.toBeNaN()
  })

  it('records the delivered state, so a later change starts from it', async () => {
    await provider.parseWebhook({
      rawBody: JSON.stringify({ type: 'subscription.canceled', subscription }),
      headers: {},
    })

    const changed = await provider.changeTier({
      providerSubscriptionId: 'mock_sub_9',
      tier: 'max',
    })

    expect(changed).toMatchObject({
      billingCustomerId: 'cus_9',
      tier: 'max',
      status: 'past_due',
    })
  })

  it('ignores event types the application does not act on', async () => {
    const event = await provider.parseWebhook({
      rawBody: JSON.stringify({ type: 'invoice.paid', subscription }),
      headers: {},
    })

    expect(event).toBeNull()
  })

  it('ignores a delivery with no subscription', async () => {
    const event = await provider.parseWebhook({
      rawBody: JSON.stringify({ type: 'subscription.active' }),
      headers: {},
    })

    expect(event).toBeNull()
  })

  it('rejects a body that is not valid JSON', async () => {
    await expect(
      provider.parseWebhook({ rawBody: 'not-json', headers: {} }),
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })
})
