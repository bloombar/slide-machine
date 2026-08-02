/**
 * Integration tests for billing (SPEC BILL-2) against a real MongoDB and the
 * in-memory billing adapter: checkout, the hosted portal, and the webhook
 * path that is the only thing allowed to change what an account may spend.
 *
 * The webhook cases are the point of the file. A payment provider retries
 * deliveries, sends them out of order, and cancels a replaced subscription
 * *after* starting its replacement — so the tests here are mostly about what
 * must **not** happen: no double application, no going backwards, and no
 * cancelling a plan the user has just upgraded to.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { PlanTier } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { loadPlans } from '../../src/config/plans'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Posts a delivery to the webhook endpoint exactly as a provider would. */
const deliver = (payload: unknown) =>
  request(server)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(payload))

/** A normalized event in the shape the mock adapter accepts. */
const event = (overrides: {
  type?: string
  providerEventId?: string
  occurredAt?: string
  subscription?: Record<string, unknown>
}) => ({
  type: overrides.type ?? 'subscription.active',
  providerEventId: overrides.providerEventId ?? 'evt_1',
  occurredAt: overrides.occurredAt ?? '2026-08-01T00:00:00.000Z',
  subscription: {
    providerSubscriptionId: 'sub_1',
    billingCustomerId: 'cus_1',
    tier: 'pro',
    status: 'active',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...overrides.subscription,
  },
})

const tierOf = async (userId: string) =>
  (await UserModel.findById(userId))?.planTier

let ada: string
let adaId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const user = await UserModel.findOne({ email: 'ada@example.com' })
  adaId = user!._id.toString()
})

describe('billing.summary', () => {
  it('reports a new account as free with nothing to manage', async () => {
    const res = await act(ada, 'billing.summary')

    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('free')
    // Never subscribed reads differently from canceled: there is no
    // subscription at all, so the status is absent rather than terminal.
    expect(res.body.status).toBeNull()
    expect(res.body.currentPeriodEnd).toBeNull()
    expect(res.body.canManageBilling).toBe(false)
  })

  it('offers only the tiers the deployment has priced', async () => {
    const res = await act(ada, 'billing.summary')

    // Free has no price by definition, so it can never be bought.
    expect(res.body.purchasableTiers).not.toContain('free')
    expect(res.body.purchasableTiers).toContain('pro')
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server).post('/api/actions/billing.summary')
    expect(res.status).toBe(401)
  })
})

describe('billing.plans', () => {
  it('describes every plan, cheapest first, with its caps and price', async () => {
    const res = await act(ada, 'billing.plans')

    expect(res.status).toBe(200)
    expect(res.body.plans.map((p: { tier: string }) => p.tier)).toEqual([
      'free',
      'fresh',
      'pro',
      'max',
    ])

    // The caps are the deployment's own plans file (PLANS_CONFIG_PATH), read
    // here rather than restated, so this test cannot drift from it (BILL-6).
    const configured = loadPlans()
    for (const plan of res.body.plans) {
      expect(plan.caps).toEqual(configured[plan.tier as PlanTier].caps)
      expect(plan.audioRetentionDays).toBe(
        configured[plan.tier as PlanTier].audioRetentionDays,
      )
    }

    // And the money comes from the provider, which is what does the charging.
    const pro = res.body.plans.find((p: { tier: string }) => p.tier === 'pro')
    expect(pro.price).toMatchObject({ currency: 'usd', interval: 'month' })
    expect(pro.price.amountMinor).toBeGreaterThan(0)
    // The free tier has nothing to charge for.
    expect(
      res.body.plans.find((p: { tier: string }) => p.tier === 'free').price,
    ).toBeNull()
  })

  it('rows every metered resource, instructor allowances before the audience’s', async () => {
    const res = await act(ada, 'billing.plans')

    const metrics = res.body.metrics as {
      metric: string
      allowance: string
      unit: string
    }[]
    // Every cap the config defines has a row, so a tuned config cannot leave
    // an allowance invisible on the pricing page.
    expect(metrics.map(m => m.metric).sort()).toEqual(
      Object.keys(loadPlans().free.caps).sort(),
    )
    const audienceFrom = metrics.findIndex(m => m.allowance === 'audience')
    expect(
      metrics.slice(audienceFrom).every(m => m.allowance === 'audience'),
    ).toBe(true)
    expect(metrics.find(m => m.metric === 'sttMinutes')?.unit).toBe('minutes')
  })

  it('offers only the tiers the deployment has priced', async () => {
    const res = await act(ada, 'billing.plans')

    const purchasable = res.body.plans
      .filter((p: { purchasable: boolean }) => p.purchasable)
      .map((p: { tier: string }) => p.tier)
    expect(purchasable).not.toContain('free')
    expect(purchasable).toContain('pro')
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server).post('/api/actions/billing.plans')
    expect(res.status).toBe(401)
  })
})

describe('billing.checkout', () => {
  it('returns a hosted checkout URL that returns to the plan tab', async () => {
    const res = await act(ada, 'billing.checkout', { tier: 'pro' })

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('/app/settings?tab=plan')
    expect(res.body.url).toContain('checkout=success')
  })

  it('records nothing until the provider says so', async () => {
    await act(ada, 'billing.checkout', { tier: 'pro' })

    // A started checkout is not a payment. The plan moves on the webhook,
    // never on the redirect — a browser that never comes back must still
    // end up on the tier they paid for, and one that comes back without
    // paying must not.
    expect(await tierOf(adaId)).toBe('free')
    expect(await SubscriptionModel.countDocuments({})).toBe(0)
  })

  it('refuses a tier that is not for sale', async () => {
    const res = await act(ada, 'billing.checkout', { tier: 'free' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('billing_unavailable')
  })

  it('rejects a return path that leaves the app', async () => {
    // An absolute URL here would make checkout an open redirect.
    const away = await act(ada, 'billing.checkout', {
      tier: 'pro',
      returnPath: 'https://evil.example.com/',
    })
    // As would a protocol-relative one, which browsers read as another host.
    const relative = await act(ada, 'billing.checkout', {
      tier: 'pro',
      returnPath: '//evil.example.com/',
    })

    expect(away.status).toBe(400)
    expect(relative.status).toBe(400)
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server)
      .post('/api/actions/billing.checkout')
      .send({ tier: 'pro' })
    expect(res.status).toBe(401)
  })
})

describe('billing.portal', () => {
  it('refuses before the account has ever been billed', async () => {
    const res = await act(ada, 'billing.portal')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('billing_unavailable')
  })

  it('opens once a subscription has been recorded', async () => {
    await deliver(event({ subscription: { userId: adaId } }))

    const res = await act(ada, 'billing.portal')

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('/app/settings?tab=plan')
  })
})

describe('the webhook', () => {
  it('puts the account on the tier it just paid for', async () => {
    const res = await deliver(event({ subscription: { userId: adaId } }))

    expect(res.status).toBe(200)
    expect(res.body.applied).toBe(true)
    expect(await tierOf(adaId)).toBe('pro')

    const sub = await SubscriptionModel.findOne({ userId: adaId })
    expect(sub?.status).toBe('active')
    expect(sub?.providerSubscriptionId).toBe('sub_1')
    expect(sub?.billingProvider).toBe('mock')
  })

  it('shows the new state on the account summary', async () => {
    await deliver(event({ subscription: { userId: adaId } }))

    const res = await act(ada, 'billing.summary')

    expect(res.body.tier).toBe('pro')
    expect(res.body.status).toBe('active')
    expect(res.body.currentPeriodEnd).toBe('2026-09-01T00:00:00.000Z')
    expect(res.body.canManageBilling).toBe(true)
  })

  it('applies a redelivery of the same event only once', async () => {
    const payload = event({ subscription: { userId: adaId } })
    await deliver(payload)

    // Providers retry until they see a 2xx, and the first attempt may well
    // have succeeded before the response was lost.
    const again = await deliver(payload)

    expect(again.status).toBe(200)
    expect(again.body.applied).toBe(false)
    expect(again.body.reason).toBe('duplicate')
    expect(await SubscriptionModel.countDocuments({})).toBe(1)
  })

  it('ignores a delivery that arrives after a newer one', async () => {
    await deliver(
      event({
        providerEventId: 'evt_new',
        occurredAt: '2026-08-10T00:00:00.000Z',
        subscription: { userId: adaId, tier: 'max' },
      }),
    )

    const late = await deliver(
      event({
        providerEventId: 'evt_old',
        occurredAt: '2026-08-01T00:00:00.000Z',
        subscription: { userId: adaId, tier: 'pro' },
      }),
    )

    expect(late.body.reason).toBe('stale')
    // The older event would otherwise demote an account that has since moved
    // up, for no reason the user could see.
    expect(await tierOf(adaId)).toBe('max')
  })

  it('does not let a replaced subscription cancel the new one', async () => {
    await deliver(
      event({
        providerEventId: 'evt_upgrade',
        occurredAt: '2026-08-05T00:00:00.000Z',
        subscription: {
          userId: adaId,
          providerSubscriptionId: 'sub_2',
          tier: 'max',
        },
      }),
    )

    // The ordinary tail of an upgrade: the provider ends the old subscription
    // after starting its replacement.
    const trailing = await deliver(
      event({
        type: 'subscription.canceled',
        providerEventId: 'evt_old_cancel',
        occurredAt: '2026-08-06T00:00:00.000Z',
        subscription: {
          userId: adaId,
          providerSubscriptionId: 'sub_1',
          status: 'canceled',
        },
      }),
    )

    expect(trailing.body.reason).toBe('superseded')
    expect(await tierOf(adaId)).toBe('max')
  })

  it('drops the account to free when the live subscription ends', async () => {
    await deliver(event({ subscription: { userId: adaId } }))

    await deliver(
      event({
        type: 'subscription.canceled',
        providerEventId: 'evt_cancel',
        occurredAt: '2026-08-20T00:00:00.000Z',
        subscription: { userId: adaId, status: 'canceled' },
      }),
    )

    expect(await tierOf(adaId)).toBe('free')
    const summary = await act(ada, 'billing.summary')
    expect(summary.body.status).toBe('canceled')
  })

  it('keeps the tier while a payment is being retried', async () => {
    await deliver(event({ subscription: { userId: adaId } }))

    await deliver(
      event({
        type: 'subscription.past_due',
        providerEventId: 'evt_past_due',
        occurredAt: '2026-08-20T00:00:00.000Z',
        subscription: { userId: adaId, status: 'past_due' },
      }),
    )

    // A failed charge is not the end of the subscription: the provider is
    // still retrying, and cutting the user off mid-lecture over an expired
    // card would be a worse failure than carrying them to the cancellation.
    expect(await tierOf(adaId)).toBe('pro')
    const summary = await act(ada, 'billing.summary')
    expect(summary.body.status).toBe('past_due')
  })

  it('attributes a later event by its subscription reference', async () => {
    await deliver(event({ subscription: { userId: adaId } }))

    // A provider that stops echoing our metadata is still recognizable by the
    // opaque reference it issued.
    const res = await deliver(
      event({
        providerEventId: 'evt_2',
        occurredAt: '2026-08-15T00:00:00.000Z',
        subscription: { tier: 'max' },
      }),
    )

    expect(res.body.applied).toBe(true)
    expect(await tierOf(adaId)).toBe('max')
  })

  it('ignores an event naming an account that is not ours', async () => {
    const res = await deliver(
      event({ subscription: { userId: '64b7f9c2f1a2b3c4d5e6f7a8' } }),
    )

    expect(res.status).toBe(200)
    expect(res.body.reason).toBe('unknown-user')
    expect(await SubscriptionModel.countDocuments({})).toBe(0)
  })

  it('ignores an event it cannot attribute to anyone', async () => {
    const res = await deliver(
      event({ subscription: { providerSubscriptionId: 'sub_unknown' } }),
    )

    expect(res.status).toBe(200)
    expect(res.body.reason).toBe('unattributed')
    expect(await SubscriptionModel.countDocuments({})).toBe(0)
  })

  it('acknowledges an event type it does not act on', async () => {
    const res = await deliver({ type: 'invoice.paid', subscription: {} })

    // Acknowledged, so the provider stops resending something we ignore.
    expect(res.status).toBe(200)
    expect(res.body.applied).toBe(false)
  })

  it('refuses a delivery it cannot verify', async () => {
    const res = await request(server)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send('this is not json')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_signature')
  })

  it('needs no session, since the caller is the provider', async () => {
    const res = await deliver(event({ subscription: { userId: adaId } }))
    expect(res.status).toBe(200)
  })
})
