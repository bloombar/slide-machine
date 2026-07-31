/**
 * Unit tests for the Stripe billing adapter against a stubbed fetch: request
 * shapes, vendor → internal normalization, error classification, and webhook
 * signature verification. Stripe is never called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import type { PlansConfig } from '@slide-machine/shared'

const testEnv = vi.hoisted(() => ({
  BILLING_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_123' as string | undefined,
  STRIPE_WEBHOOK_SECRET: 'whsec_test' as string | undefined,
  // The real plans file, so the adapter's default (uninjected) plans load.
  PLANS_CONFIG_PATH: new URL('../../../config/plans.json', import.meta.url)
    .pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { StripeBillingProvider, verifySignature } from './stripe'
import { loadPlans } from '../config/plans'
import { BillingUnavailableError, WebhookVerificationError } from './errors'

const caps = {
  geminiTokens: null,
  sttMinutes: null,
  imageCalls: null,
  exports: null,
}
const plans: PlansConfig = {
  free: { priceId: null, caps },
  pro: { priceId: 'price_pro', caps },
  max: { priceId: 'price_max', caps },
}

/** A Stripe subscription object with the fields the adapter reads. */
const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  cancel_at_period_end: false,
  current_period_start: 1767225600, // 2026-01-01T00:00:00Z
  current_period_end: 1769904000, // 2026-02-01T00:00:00Z
  items: { data: [{ id: 'si_123', price: { id: 'price_pro' } }] },
  ...overrides,
})

const checkout = {
  userId: 'user-1',
  email: 'author@example.edu',
  tier: 'pro' as const,
  successUrl: 'https://app.test/done',
  cancelUrl: 'https://app.test/billing',
}

let fetchMock: ReturnType<typeof vi.fn>
let provider: StripeBillingProvider

/** The nth fetch call as the [url, init] pair the adapter passed. */
const fetchCall = (
  call = 0,
): [
  string,
  { method: string; headers: Record<string, string>; body?: string },
] => fetchMock.mock.calls[call] as never

/** The body of the nth fetch call, decoded from form encoding. */
const postedParams = (call = 0): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(fetchCall(call)[1].body))

beforeEach(() => {
  testEnv.STRIPE_SECRET_KEY = 'sk_test_123'
  testEnv.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  provider = new StripeBillingProvider(plans)
})
afterEach(() => vi.unstubAllGlobals())

describe('StripeBillingProvider.createCheckoutSession', () => {
  it('opens a subscription checkout for the tier price and returns its url', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe/cs_1' }),
    })

    const session = await provider.createCheckoutSession(checkout)

    expect(session).toEqual({
      url: 'https://checkout.stripe/cs_1',
      providerSessionId: 'cs_1',
    })
    const [url, init] = fetchCall()
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(init.headers.Authorization).toBe('Bearer sk_test_123')
    expect(postedParams()).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_pro',
      'line_items[0][quantity]': '1',
      success_url: checkout.successUrl,
      cancel_url: checkout.cancelUrl,
      client_reference_id: 'user-1',
      'subscription_data[metadata][userId]': 'user-1',
      customer_email: 'author@example.edu',
    })
  })

  it('bills a returning user against their existing customer record', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_2', url: 'https://checkout.stripe/cs_2' }),
    })

    await provider.createCheckoutSession({
      ...checkout,
      billingCustomerId: 'cus_123',
    })

    const params = postedParams()
    expect(params.customer).toBe('cus_123')
    expect(params.customer_email).toBeUndefined()
  })

  it('refuses a tier that has no configured price', async () => {
    await expect(
      provider.createCheckoutSession({ ...checkout, tier: 'free' }),
    ).rejects.toThrowError(/no billing price configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the provider returns no checkout page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_3' }),
    })

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({
      name: 'BillingUnavailableError',
      retryable: true,
    })
  })

  it('tolerates a session response that omits its id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe/anon' }),
    })

    const session = await provider.createCheckoutSession(checkout)

    expect(session.providerSessionId).toBe('')
  })

  it('defaults the plans to server config when none is injected', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_4', url: 'https://checkout.stripe/cs_4' }),
    })

    await new StripeBillingProvider().createCheckoutSession(checkout)

    expect(postedParams()['line_items[0][price]']).toBe(loadPlans().pro.priceId)
  })
})

describe('StripeBillingProvider request failures', () => {
  it('reports a missing secret key as unconfigured, without calling out', async () => {
    testEnv.STRIPE_SECRET_KEY = undefined

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({
      message: 'Billing is not configured',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a network failure as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({ retryable: true })
  })

  it.each([
    [429, true],
    [503, true],
  ])('treats HTTP %i as retryable', async (status, retryable) => {
    fetchMock.mockResolvedValue({
      ok: false,
      status,
      text: async () => 'busy',
    })

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({ retryable })
  })

  it('surfaces the detail of a permanent rejection', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'No such price',
    })

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({
      message: expect.stringContaining('(400): No such price'),
      retryable: false,
    })
  })

  it('still reports the status when the error body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => {
        throw new Error('stream closed')
      },
    })

    await expect(
      provider.createCheckoutSession(checkout),
    ).rejects.toMatchObject({
      message: expect.stringContaining('(402)'),
      retryable: false,
    })
  })
})

describe('StripeBillingProvider.changeTier', () => {
  it('swaps the subscription item price and prorates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => stripeSubscription(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          stripeSubscription({
            items: { data: [{ id: 'si_123', price: { id: 'price_max' } }] },
          }),
      })

    const snapshot = await provider.changeTier({
      providerSubscriptionId: 'sub_123',
      tier: 'max',
    })

    expect(fetchCall()[1].method).toBe('GET')
    expect(postedParams(1)).toEqual({
      'items[0][id]': 'si_123',
      'items[0][price]': 'price_max',
      proration_behavior: 'create_prorations',
    })
    expect(snapshot).toEqual({
      providerSubscriptionId: 'sub_123',
      billingCustomerId: 'cus_123',
      tier: 'max',
      status: 'active',
      currentPeriodStart: '2026-01-01T00:00:00.000Z',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })
  })

  it('fails when the subscription has no billable item', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => stripeSubscription({ items: { data: [] } }),
    })

    await expect(
      provider.changeTier({ providerSubscriptionId: 'sub_123', tier: 'max' }),
    ).rejects.toThrowError(/no billable item/)
  })
})

describe('StripeBillingProvider.createPortalSession', () => {
  it('returns the hosted portal url', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://portal.stripe/session' }),
    })

    const session = await provider.createPortalSession({
      billingCustomerId: 'cus_123',
      returnUrl: 'https://app.test/settings',
    })

    expect(session).toEqual({ url: 'https://portal.stripe/session' })
    expect(fetchCall()[0]).toBe(
      'https://api.stripe.com/v1/billing_portal/sessions',
    )
    expect(postedParams()).toEqual({
      customer: 'cus_123',
      return_url: 'https://app.test/settings',
    })
  })

  it('fails when the provider returns no portal page', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    await expect(
      provider.createPortalSession({
        billingCustomerId: 'cus_123',
        returnUrl: 'https://app.test/settings',
      }),
    ).rejects.toMatchObject({ retryable: true })
  })
})

describe('StripeBillingProvider.cancelSubscription', () => {
  it('cancels at period end by default, keeping the plan active until then', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => stripeSubscription({ cancel_at_period_end: true }),
    })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
    })

    expect(fetchCall()[1].method).toBe('POST')
    expect(postedParams()).toEqual({ cancel_at_period_end: 'true' })
    expect(snapshot).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
    })
  })

  it('deletes the subscription when cancelling immediately', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => stripeSubscription({ status: 'canceled' }),
    })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
      atPeriodEnd: false,
    })

    const [url, init] = fetchCall()
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_123')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(snapshot.status).toBe('canceled')
  })
})

describe('StripeBillingProvider normalization', () => {
  it('reads period bounds from the subscription item when the root omits them', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        stripeSubscription({
          current_period_start: undefined,
          current_period_end: undefined,
          items: {
            data: [
              {
                id: 'si_123',
                price: { id: 'price_pro' },
                current_period_start: 1767225600,
                current_period_end: 1769904000,
              },
            ],
          },
        }),
    })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
    })

    expect(snapshot.currentPeriodStart).toBe('2026-01-01T00:00:00.000Z')
    expect(snapshot.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z')
  })

  it('degrades an unknown price to the free tier rather than granting entitlements', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        stripeSubscription({
          items: { data: [{ id: 'si_123', price: { id: 'price_retired' } }] },
        }),
    })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
    })

    expect(snapshot.tier).toBe('free')
  })

  it('treats an unrecognized status as canceled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => stripeSubscription({ status: 'paused' }),
    })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
    })

    expect(snapshot.status).toBe('canceled')
  })

  it('tolerates a response missing every optional field', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const snapshot = await provider.cancelSubscription({
      providerSubscriptionId: 'sub_123',
    })

    expect(snapshot).toEqual({
      providerSubscriptionId: '',
      billingCustomerId: '',
      tier: 'free',
      status: 'canceled',
      currentPeriodStart: '1970-01-01T00:00:00.000Z',
      currentPeriodEnd: '1970-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })
  })
})

/** Builds the `Stripe-Signature` header for a body, as Stripe would. */
const sign = (
  rawBody: string,
  secret = 'whsec_test',
  timestamp = Math.floor(Date.now() / 1000),
): string => {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  return `t=${timestamp},v1=${digest}`
}

const delivery = (event: unknown, header?: string) => {
  const rawBody = JSON.stringify(event)
  return {
    rawBody,
    headers: { 'stripe-signature': header ?? sign(rawBody) },
  }
}

describe('StripeBillingProvider.parseWebhook', () => {
  it.each([
    ['active', 'subscription.active'],
    ['trialing', 'subscription.active'],
    ['past_due', 'subscription.past_due'],
    ['unpaid', 'subscription.past_due'],
    ['canceled', 'subscription.canceled'],
    ['incomplete_expired', 'subscription.canceled'],
  ])('normalizes stripe status %s into %s', async (status, expected) => {
    const event = await provider.parseWebhook(
      delivery({
        id: 'evt_1',
        type: 'customer.subscription.updated',
        created: 1767225600,
        data: { object: stripeSubscription({ status }) },
      }),
    )

    expect(event).toEqual({
      type: expected,
      providerEventId: 'evt_1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      subscription: {
        providerSubscriptionId: 'sub_123',
        billingCustomerId: 'cus_123',
        tier: 'pro',
        status: expected.replace('subscription.', ''),
        currentPeriodStart: '2026-01-01T00:00:00.000Z',
        currentPeriodEnd: '2026-02-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    })
  })

  it('ignores event types the application does not act on', async () => {
    const event = await provider.parseWebhook(
      delivery({
        id: 'evt_2',
        type: 'invoice.paid',
        data: { object: stripeSubscription() },
      }),
    )

    expect(event).toBeNull()
  })

  it('ignores a subscription event carrying no object', async () => {
    const event = await provider.parseWebhook(
      delivery({
        id: 'evt_3',
        type: 'customer.subscription.created',
        data: {},
      }),
    )

    expect(event).toBeNull()
  })

  it('ignores a delivery with no event type', async () => {
    const event = await provider.parseWebhook(
      delivery({ id: 'evt_6', data: { object: stripeSubscription() } }),
    )

    expect(event).toBeNull()
  })

  it('ignores a subscription object with no status', async () => {
    const event = await provider.parseWebhook(
      delivery({
        id: 'evt_7',
        type: 'customer.subscription.updated',
        data: { object: stripeSubscription({ status: undefined }) },
      }),
    )

    expect(event).toBeNull()
  })

  it('tolerates an event that omits its id and timestamp', async () => {
    const event = await provider.parseWebhook(
      delivery({
        type: 'customer.subscription.created',
        data: { object: stripeSubscription() },
      }),
    )

    expect(event).toMatchObject({
      providerEventId: '',
      occurredAt: '1970-01-01T00:00:00.000Z',
    })
  })

  it('ignores a status with no internal meaning', async () => {
    const event = await provider.parseWebhook(
      delivery({
        id: 'evt_4',
        type: 'customer.subscription.created',
        data: { object: stripeSubscription({ status: 'incomplete' }) },
      }),
    )

    expect(event).toBeNull()
  })

  it('rejects a delivery whose signature does not match', async () => {
    await expect(
      provider.parseWebhook(
        delivery(
          { id: 'evt_5', type: 'customer.subscription.created' },
          sign('{"tampered":true}'),
        ),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })
})

describe('verifySignature', () => {
  it('accepts a correctly signed body', () => {
    expect(() => verifySignature('{}', sign('{}'))).not.toThrow()
  })

  it('rejects a body signed with the wrong secret', () => {
    expect(() => verifySignature('{}', sign('{}', 'whsec_other'))).toThrowError(
      /does not match/,
    )
  })

  it('rejects a signature of the wrong length outright', () => {
    expect(() =>
      verifySignature('{}', `t=${Math.floor(Date.now() / 1000)},v1=short`),
    ).toThrowError(/does not match/)
  })

  it('rejects a replayed delivery outside the tolerance window', () => {
    const stale = Math.floor(Date.now() / 1000) - 3600
    expect(() =>
      verifySignature('{}', sign('{}', 'whsec_test', stale)),
    ).toThrowError(/outside tolerance/)
  })

  it('rejects a non-numeric timestamp', () => {
    expect(() => verifySignature('{}', 't=never,v1=abc')).toThrowError(
      /outside tolerance/,
    )
  })

  it('rejects a header with no signature component', () => {
    expect(() =>
      verifySignature('{}', `t=${Math.floor(Date.now() / 1000)}`),
    ).toThrowError(/Malformed/)
  })

  it('rejects a missing header', () => {
    expect(() => verifySignature('{}', undefined)).toThrowError(/Missing/)
  })

  it('refuses to verify when no webhook secret is configured', () => {
    testEnv.STRIPE_WEBHOOK_SECRET = undefined

    expect(() => verifySignature('{}', sign('{}'))).toThrowError(
      /not configured/,
    )
  })
})

describe('registration', () => {
  it('is the adapter the registry resolves for BILLING_PROVIDER=stripe', async () => {
    const { billingRegistry } = await import('./registry')

    expect(billingRegistry.get()).toBeInstanceOf(StripeBillingProvider)
  })
})

describe('billing errors', () => {
  it('are the billing error types, not bare Errors', async () => {
    testEnv.STRIPE_SECRET_KEY = undefined

    await expect(
      provider.createPortalSession({
        billingCustomerId: 'cus_123',
        returnUrl: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(BillingUnavailableError)
  })
})
