/**
 * Integration test for usage metering and cap enforcement (BILL-3/BILL-4).
 * MongoDB is real; the generation provider is the mock, so no tokens are
 * bought — the counter is driven directly where a real Gemini response would
 * report `usageMetadata`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { UsageRecordModel } from '../../src/models/usage-record'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  recordUsage,
  usedThisPeriod,
  usageSummary,
  periodKeyFor,
  capFor,
} from '../../src/billing/usage'

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

let ada: string
let adaId: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), UsageRecordModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('usage counters', () => {
  it('accumulates across calls within a period', async () => {
    await recordUsage(adaId, 'aiTokens', 1200)
    await recordUsage(adaId, 'aiTokens', 800)

    expect(await usedThisPeriod(adaId, 'aiTokens')).toBe(2000)
  })

  it('counts a cached event without spending the allowance', async () => {
    await recordUsage(adaId, 'ttsCharacters', 5000, { billable: false })

    // Recorded — the user is active this period — but nothing was debited,
    // because serving already-synthesized audio costs nothing.
    expect(await usedThisPeriod(adaId, 'ttsCharacters')).toBe(0)
    expect(await UsageRecordModel.countDocuments({ userId: adaId })).toBe(1)
  })

  it('keeps one counter per metric', async () => {
    await recordUsage(adaId, 'aiTokens', 100)
    await recordUsage(adaId, 'sttMinutes', 7)

    expect(await usedThisPeriod(adaId, 'aiTokens')).toBe(100)
    expect(await usedThisPeriod(adaId, 'sttMinutes')).toBe(7)
  })

  it('reports every metric with its cap for the account view', async () => {
    await recordUsage(adaId, 'aiTokens', 4242)

    const summary = await usageSummary(adaId, 'free')

    expect(summary.metrics.aiTokens).toEqual({
      used: 4242,
      cap: capFor('free', 'aiTokens'),
    })
    // Metrics never touched still appear, so the UI can show remaining quota
    // for everything rather than only what has been used.
    expect(summary.metrics.ttsCharacters?.used).toBe(0)
  })
})

describe('billing period', () => {
  it('uses the calendar month when the user has no subscription', async () => {
    expect(await periodKeyFor(adaId)).toBe(new Date().toISOString().slice(0, 7))
  })

  it("follows an active subscription's period instead", async () => {
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

    expect(await periodKeyFor(adaId)).toBe('2026-03-17')
  })

  it('separates usage recorded in different periods', async () => {
    await recordUsage(adaId, 'aiTokens', 500)
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

    // The new period starts empty; the old counter is untouched, not reset.
    expect(await usedThisPeriod(adaId, 'aiTokens')).toBe(0)
    expect(await UsageRecordModel.countDocuments({ userId: adaId })).toBe(1)
  })
})

describe('cap enforcement', () => {
  it('402s a metered action once the allowance is spent', async () => {
    const cap = capFor('free', 'aiTokens')!
    await recordUsage(adaId, 'aiTokens', cap)

    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis converts light into chemical energy.',
    })

    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('plan_limit_exceeded')
    // The metric rides along so the client can name the right upgrade prompt.
    expect(res.body.error.details).toEqual(['aiTokens'])
  })

  it('allows the call while the allowance remains', async () => {
    await recordUsage(adaId, 'aiTokens', 10)

    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis converts light into chemical energy.',
    })

    expect(res.status).toBe(200)
  })

  it('blocks only the over-spent metric, not every action', async () => {
    await recordUsage(adaId, 'aiTokens', capFor('free', 'aiTokens')!)

    // deck.rename spends nothing, so it is unaffected by an exhausted AI cap.
    const res = await act(ada, 'deck.rename', { deckId, title: 'Renamed' })

    expect(res.status).toBe(200)
  })

  it("checks against the acting user's own tier, not a default", async () => {
    await UserModel.updateOne({ _id: adaId }, { planTier: 'pro' })
    // Spend past what Free allows but well inside Pro: the same usage that
    // blocks one user must not block another on a larger plan.
    await recordUsage(adaId, 'aiTokens', capFor('free', 'aiTokens')!)

    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Still generating on a larger plan.',
    })

    expect(res.status).toBe(200)
    expect(capFor('pro', 'aiTokens')!).toBeGreaterThan(
      capFor('free', 'aiTokens')!,
    )
  })
})
