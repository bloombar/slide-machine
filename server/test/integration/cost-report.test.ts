/**
 * Integration tests for reading the cost ledger (BILL-7).
 *
 * Every assertion here is about a *decision* the report makes rather than
 * about arithmetic: which side of the instructor/audience line a row falls on,
 * who counts as a person and who only as an event, and what an average divides
 * by. Those are the things a well-meaning refactor gets wrong quietly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { CostEventModel } from '../../src/models/cost-event'
import { UserModel } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { costOverview, costSummary } from '../../src/billing/cost-report'

const server = createApp().listen(0)
afterAll(() => server.close())

const ada = new Types.ObjectId()
const viewer = new Types.ObjectId()
const deckId = new Types.ObjectId()
const projectId = new Types.ObjectId()

/** Writes one ledger row. Defaults describe the commonest case — the owner's
 * own billable work on their own lecture — so each test states only what makes
 * it different. */
const event = async (over: Record<string, unknown> = {}) =>
  CostEventModel.create({
    payerId: ada,
    actorId: ada,
    actorKind: 'owner',
    projectId,
    projectName: 'Physics 101',
    deckId,
    deckName: 'Standing waves',
    metric: 'aiTokens',
    quantity: 1000,
    billable: true,
    costMicros: 1000,
    currency: 'USD',
    occurredAt: new Date(),
    ...over,
  })

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([CostEventModel.init(), UserModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    CostEventModel.deleteMany({}),
    UserModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
})

describe('instructor versus audience', () => {
  it('splits a total by who caused it', async () => {
    await event({ costMicros: 1000 })
    await event({
      actorKind: 'audience',
      actorId: viewer,
      costMicros: 400,
      metric: 'audienceTtsCharacters',
    })
    await event({ actorKind: 'system', actorId: null, costMicros: 50 })

    const summary = await costSummary({ payerId: ada.toString() })
    expect(summary.total.micros).toBe(1450)
    expect(summary.instructor.micros).toBe(1000)
    expect(summary.audience.micros).toBe(400)
    // Neither instructor nor viewer spend: a sweep is the deployment's doing
    // and neither remedy applies to it.
    expect(summary.system.micros).toBe(50)
  })

  it('charges audience work to the owner, not to the viewer', async () => {
    await event({
      actorKind: 'audience',
      actorId: viewer,
      costMicros: 400,
    })
    // The viewer caused it; the owner's report is where it lands.
    expect(
      (await costSummary({ payerId: ada.toString() })).audience.micros,
    ).toBe(400)
    expect(
      (await costSummary({ payerId: viewer.toString() })).total.micros,
    ).toBe(0)
  })
})

describe('counting people', () => {
  it('counts a viewer once however many events they cause', async () => {
    for (let i = 0; i < 5; i += 1)
      await event({ actorKind: 'audience', actorId: viewer, costMicros: 100 })

    const summary = await costSummary({ deckId: deckId.toString() })
    expect(summary.registeredViewers).toBe(1)
    expect(summary.costPerRegisteredViewer?.micros).toBe(500)
  })

  it('counts anonymous viewers as events, never as people', async () => {
    await event({ actorKind: 'audience', actorId: viewer, costMicros: 100 })
    await event({ actorKind: 'audience', actorId: null, costMicros: 100 })
    await event({ actorKind: 'audience', actorId: null, costMicros: 100 })

    const summary = await costSummary({ deckId: deckId.toString() })
    expect(summary.registeredViewers).toBe(1)
    expect(summary.anonymousEvents).toBe(2)
    // The average is over registered viewers only, and the DTO says so — an
    // average that silently folded in the anonymous ones would be a lie.
    expect(summary.costPerRegisteredViewer?.micros).toBe(300)
  })

  it('has no per-viewer figure when no viewer was registered', async () => {
    await event({ actorKind: 'audience', actorId: null, costMicros: 100 })
    const summary = await costSummary({ deckId: deckId.toString() })
    expect(summary.costPerRegisteredViewer).toBeNull()
  })

  it('counts a deck that reached thirty as having reached thirty', async () => {
    // The case the whole "record cache hits" rule exists for: two viewers pay
    // for a translation, twenty-eight read it for free, and an average over
    // two would be an order of magnitude wrong.
    for (let i = 0; i < 2; i += 1) {
      await event({
        actorKind: 'audience',
        actorId: new Types.ObjectId(),
        costMicros: 1000,
      })
    }
    for (let i = 0; i < 28; i += 1) {
      await event({
        actorKind: 'audience',
        actorId: new Types.ObjectId(),
        billable: false,
        costMicros: 0,
      })
    }
    const summary = await costSummary({ deckId: deckId.toString() })
    expect(summary.registeredViewers).toBe(30)
    expect(summary.audience.micros).toBe(2000)
    // ~67 micros each, not 1000 each.
    expect(summary.costPerRegisteredViewer?.micros).toBeLessThan(100)
  })
})

describe('cache efficiency', () => {
  it('reports the hit ratio from the same rows', async () => {
    await event({ billable: true, costMicros: 1000 })
    await event({ billable: false, costMicros: 0 })
    await event({ billable: false, costMicros: 0 })

    const { cache } = await costSummary({ deckId: deckId.toString() })
    expect(cache.billableEvents).toBe(1)
    expect(cache.cachedEvents).toBe(2)
    expect(cache.hitRatio).toBeCloseTo(2 / 3)
  })

  it('estimates what caching avoided, at the rate that metric really billed', async () => {
    // 1000 micros for 1000 units billed → 1 micro a unit; 2000 cached units
    // would have cost 2000.
    await event({ metric: 'ttsCharacters', quantity: 1000, costMicros: 1000 })
    await event({
      metric: 'ttsCharacters',
      quantity: 2000,
      billable: false,
      costMicros: 0,
    })
    const { cache } = await costSummary({ deckId: deckId.toString() })
    expect(cache.estimatedAvoided.micros).toBe(2000)
  })

  it('estimates nothing for a metric never actually billed', async () => {
    // No rate to price against, so no invented figure.
    await event({ metric: 'exports', billable: false, costMicros: 0 })
    const { cache } = await costSummary({ deckId: deckId.toString() })
    expect(cache.estimatedAvoided.micros).toBe(0)
  })

  it('prices avoided cost per metric, not from a blended rate', async () => {
    // Cheap lookups must not make avoided narration look cheap.
    await event({ metric: 'imageLookups', quantity: 1000, costMicros: 0 })
    await event({ metric: 'ttsCharacters', quantity: 100, costMicros: 1000 })
    await event({
      metric: 'ttsCharacters',
      quantity: 100,
      billable: false,
      costMicros: 0,
    })
    const { cache } = await costSummary({ deckId: deckId.toString() })
    expect(cache.estimatedAvoided.micros).toBe(1000)
  })
})

describe('scopes', () => {
  it('rolls up per lecture and per project independently', async () => {
    const otherDeck = new Types.ObjectId()
    await event({ costMicros: 100 })
    await event({ deckId: otherDeck, deckName: 'Other', costMicros: 200 })

    expect(
      (await costSummary({ deckId: deckId.toString() })).total.micros,
    ).toBe(100)
    // Both lectures belong to the project, so its total is their sum.
    expect(
      (await costSummary({ projectId: projectId.toString() })).total.micros,
    ).toBe(300)
  })

  it('honours a reporting window', async () => {
    const old = new Date(Date.now() - 90 * 86_400_000)
    await event({ costMicros: 100, occurredAt: old })
    await event({ costMicros: 200 })

    const recent = await costSummary(
      { payerId: ada.toString() },
      { from: new Date(Date.now() - 7 * 86_400_000) },
    )
    expect(recent.total.micros).toBe(200)
    expect((await costSummary({ payerId: ada.toString() })).total.micros).toBe(
      300,
    )
  })

  it('breaks a total down by service, dearest first', async () => {
    await event({ metric: 'aiTokens', costMicros: 100 })
    await event({ metric: 'sttMinutes', costMicros: 900 })

    const summary = await costSummary({ payerId: ada.toString() })
    expect(summary.byMetric[0]?.metric).toBe('sttMinutes')
    expect(summary.byMetric[0]?.cost.micros).toBe(900)
  })
})

describe('the deployment-wide overview', () => {
  it('averages over what actually spent, not over what exists', async () => {
    const quiet = new Types.ObjectId()
    await UserModel.create([
      { _id: ada, email: 'ada@example.com', displayName: 'Ada' },
      { _id: quiet, email: 'quiet@example.com', displayName: 'Quiet' },
    ])
    await event({ costMicros: 1000 })

    const overview = await costOverview()
    // Two accounts exist; one spent. A dormant account is not a cheap user.
    expect(overview.activeUsers).toBe(1)
    expect(overview.averages.perUser?.micros).toBe(1000)
  })

  it('ranks the largest spenders and names them', async () => {
    const byron = new Types.ObjectId()
    await UserModel.create([
      { _id: ada, email: 'ada@example.com', displayName: 'Ada' },
      { _id: byron, email: 'byron@example.com', displayName: 'Byron' },
    ])
    await event({ costMicros: 100 })
    await event({ payerId: byron, actorId: byron, costMicros: 900 })

    const { topSpenders } = await costOverview()
    expect(topSpenders[0]?.email).toBe('byron@example.com')
    expect(topSpenders[0]?.cost.micros).toBe(900)
  })

  it('still ranks a spender whose account is gone', async () => {
    // Ledger rows are never cascade-deleted: the spend still happened.
    await event({ costMicros: 500 })
    const { topSpenders } = await costOverview()
    expect(topSpenders[0]?.payerId).toBe(ada.toString())
    expect(topSpenders[0]?.email).toBeUndefined()
  })

  it('counts lectures and projects that spent, not all of them', async () => {
    await event({ costMicros: 100 })
    await event({ deckId: null, projectId: null, costMicros: 100 })
    const overview = await costOverview()
    expect(overview.lecturesWithSpend).toBe(1)
    expect(overview.projectsWithSpend).toBe(1)
  })
})

describe('the API is operators-only', () => {
  const paths = [
    '/api/admin/cost',
    `/api/admin/cost/users/${ada.toString()}`,
    `/api/admin/cost/decks/${deckId.toString()}`,
    '/api/admin/cost/export',
  ]

  it.each(paths)('refuses %s without admin', async path => {
    // What a deployment spends on whom spans every account, so it is an
    // operator's business rather than a user's.
    const res = await request(server).get(path)
    expect([401, 403]).toContain(res.status)
  })
})
