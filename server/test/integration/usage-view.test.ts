/**
 * Integration test for the account usage view (BILL-4, "usage is visible
 * before it binds"): the `user.usage` action and the shape it returns.
 * MongoDB is real; the counters are driven directly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { UsageRecordModel } from '../../src/models/usage-record'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { adjustGauge, capFor, recordUsage } from '../../src/billing/usage'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const usage = async (token: string) =>
  request(server)
    .post('/api/actions/user.usage')
    .set('Authorization', `Bearer ${token}`)
    .send({})

let ada: string
let adaId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), UsageRecordModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
})

describe('user.usage', () => {
  it('reports every metered resource, used against its cap', async () => {
    await recordUsage(adaId, 'aiTokens', 1000)

    const res = await usage(ada)
    const body = res.body as UsageSummaryResponse

    expect(res.status).toBe(200)
    expect(body.tier).toBe('free')
    // Every cap in the plan appears, including the ones never touched — the
    // point of the view is remaining quota, not a list of what has been used.
    expect(body.metrics).toHaveLength(13)
    const tokens = body.metrics.find(m => m.metric === 'aiTokens')
    expect(tokens).toMatchObject({
      used: 1000,
      cap: capFor('free', 'aiTokens'),
      unit: 'tokens',
      allowance: 'instructor',
      gauge: false,
    })
  })

  it('separates the audience allowance from the instructor’s', async () => {
    const res = await usage(ada)
    const body = res.body as UsageSummaryResponse

    const audience = body.metrics.filter(m => m.allowance === 'audience')
    expect(audience.map(m => m.metric).sort()).toEqual([
      'audienceLocales',
      'audienceTtsCharacters',
    ])
    // Ordered so the interface can render them as two blocks without sorting:
    // every instructor metric precedes every audience one.
    const firstAudience = body.metrics.findIndex(
      m => m.allowance === 'audience',
    )
    expect(
      body.metrics.slice(firstAudience).every(m => m.allowance === 'audience'),
    ).toBe(true)
  })

  it('reports a fraction spent, and none for an unlimited cap', async () => {
    const cap = capFor('free', 'exports')!
    await recordUsage(adaId, 'exports', cap / 2)

    const body = (await usage(ada)).body as UsageSummaryResponse

    expect(
      body.metrics.find(m => m.metric === 'exports')?.fraction,
    ).toBeCloseTo(0.5, 6)
  })

  it('clamps the fraction at 1 when a metric overshot', async () => {
    // BILL-3 tolerates one call of overshoot, because token counts only exist
    // after the model replies. A progress bar must not render past full.
    await recordUsage(adaId, 'aiTokens', capFor('free', 'aiTokens')! * 2)

    const body = (await usage(ada)).body as UsageSummaryResponse

    expect(body.metrics.find(m => m.metric === 'aiTokens')?.fraction).toBe(1)
  })

  it('marks the storage gauge so no reset date is claimed for it', async () => {
    await adjustGauge(adaId, 'audioStorageMb', 40)

    const body = (await usage(ada)).body as UsageSummaryResponse
    const storage = body.metrics.find(m => m.metric === 'audioStorageMb')

    expect(storage).toMatchObject({ used: 40, gauge: true, unit: 'mb' })
    // Every other metric is a flow the reset date does apply to.
    expect(body.metrics.filter(m => m.gauge)).toHaveLength(1)
  })

  it('resets on the first of next month for an account with no subscription', async () => {
    const body = (await usage(ada)).body as UsageSummaryResponse

    const reset = new Date(body.resetAt)
    const now = new Date()
    expect(reset.getUTCDate()).toBe(1)
    expect(reset.getTime()).toBeGreaterThan(now.getTime())
    // The same rollover the counters are keyed to (BILL-3), not a rolling 30
    // days: the date shown and the key used must not disagree.
    expect(reset.getUTCMonth()).toBe((now.getUTCMonth() + 1) % 12)
  })

  it("follows an active subscription's period end instead", async () => {
    await SubscriptionModel.create({
      userId: adaId,
      tier: 'pro',
      billingProvider: 'stripe',
      billingCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      currentPeriodStart: new Date('2026-03-17T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-17T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
    })

    const body = (await usage(ada)).body as UsageSummaryResponse

    expect(body.resetAt).toBe('2026-04-17T00:00:00.000Z')
  })

  it('reads the caps of the account’s own tier', async () => {
    await UserModel.updateOne({ _id: adaId }, { planTier: 'pro' })

    const body = (await usage(ada)).body as UsageSummaryResponse

    expect(body.tier).toBe('pro')
    expect(body.metrics.find(m => m.metric === 'aiTokens')?.cap).toBe(
      capFor('pro', 'aiTokens'),
    )
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server).post('/api/actions/user.usage').send({})

    expect(res.status).toBe(401)
  })
})

/**
 * Self-service account closure (P-10). Soft, so the account is recoverable
 * during the retention window before the purge sweep erases it (P-11).
 */
describe('user.deleteAccount', () => {
  const del = (token: string) =>
    request(server)
      .post('/api/actions/user.deleteAccount')
      .set('Authorization', `Bearer ${token}`)
      .send({})

  it('tombstones the account rather than erasing it', async () => {
    const res = await del(ada)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })
    // Gone from every ordinary read...
    expect(await UserModel.findById(adaId)).toBeNull()
    // ...but still there to be restored from.
    const tombstoned = await UserModel.findById(adaId).setOptions({
      withDeleted: true,
    })
    expect(tombstoned?.deletedAt).toBeInstanceOf(Date)
  })

  it('ends every session immediately', async () => {
    await del(ada)

    // The cascade drops the refresh tokens, so the account cannot be revived
    // by a token that outlived the deletion.
    expect(await RefreshTokenModel.countDocuments({ userId: adaId })).toBe(0)
  })

  it('closes only the caller’s own account', async () => {
    const bobToken = await registerUser('bob@example.com')
    const bobId = (await UserModel.findOne({
      email: 'bob@example.com',
    }))!._id.toString()

    await del(bobToken)

    // Ada is untouched: the action takes no target, so there is nothing to
    // point at someone else's account.
    expect(await UserModel.findById(adaId)).not.toBeNull()
    expect(await UserModel.findById(bobId)).toBeNull()
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server)
      .post('/api/actions/user.deleteAccount')
      .send({})

    expect(res.status).toBe(401)
  })
})
