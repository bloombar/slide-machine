/**
 * Integration tests for the cost report's named windows (BILL-7):
 * `?window=period` scopes a summary to the payer's current billing period —
 * the user's own on a user scope, the owner's on a project or lecture scope —
 * and `?window=all` reads the whole ledger. MongoDB is real; the ledger is
 * written directly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import type { CostSummaryResponse } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { CostEventModel } from '../../src/models/cost-event'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), CostEventModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const get = (token: string, path: string) =>
  request(server).get(path).set('Authorization', `Bearer ${token}`)

/** One ledger row charged to `payerId`; defaults are a billable owner event
 * that happened just now. */
const event = (
  payerId: string,
  over: Record<string, unknown> = {},
): Promise<unknown> =>
  CostEventModel.create({
    payerId: new Types.ObjectId(payerId),
    actorId: new Types.ObjectId(payerId),
    actorKind: 'owner',
    metric: 'aiTokens',
    quantity: 1000,
    billable: true,
    costMicros: 1000,
    currency: 'USD',
    occurredAt: new Date(),
    ...over,
  })

/** An instant safely inside a long-closed period. */
const LONG_AGO = new Date('2020-01-15T00:00:00.000Z')

let admin: string
let adaId: string

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    CostEventModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  admin = await registerUser(ADMIN_EMAIL)
  await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
})

describe('?window=period on a user scope', () => {
  it('counts only events since the calendar month began', async () => {
    // The free tier has no subscription, so its period is the UTC month —
    // the same boundary the allowance counters are keyed to (BILL-3).
    await event(adaId, { costMicros: 700, occurredAt: LONG_AGO })
    await event(adaId, { costMicros: 300 })

    const period = (
      await get(admin, `/api/admin/cost/users/${adaId}?window=period`)
    ).body as CostSummaryResponse
    const all = (await get(admin, `/api/admin/cost/users/${adaId}?window=all`))
      .body as CostSummaryResponse

    expect(period.total.micros).toBe(300)
    expect(all.total.micros).toBe(1000)
    // The response says which span it covered, so the client never re-derives
    // period boundaries the server already knows.
    const from = new Date(period.window!.from!)
    expect(from.getUTCDate()).toBe(1)
    expect(from.getUTCMonth()).toBe(new Date().getUTCMonth())
    expect(all.window).toEqual({ from: null, to: null })
  })

  it("follows an active subscription's period start instead", async () => {
    const start = new Date(Date.now() - 5 * 86_400_000)
    await SubscriptionModel.create({
      userId: adaId,
      tier: 'pro',
      billingProvider: 'stripe',
      billingCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: new Date(Date.now() + 25 * 86_400_000),
      cancelAtPeriodEnd: false,
    })
    // One event before this period started, one inside it.
    await event(adaId, {
      costMicros: 700,
      occurredAt: new Date(Date.now() - 10 * 86_400_000),
    })
    await event(adaId, { costMicros: 300 })

    const period = (
      await get(admin, `/api/admin/cost/users/${adaId}?window=period`)
    ).body as CostSummaryResponse

    expect(period.total.micros).toBe(300)
    expect(period.window!.from).toBe(start.toISOString())
  })
})

describe("?window=period on an owned scope resolves the owner's period", () => {
  it('windows a project by its owner’s billing period', async () => {
    const project = await ProjectModel.create({
      ownerId: adaId,
      title: 'Physics',
      visibility: 'restricted',
      viewers: [],
      editors: [],
    })
    await event(adaId, {
      projectId: project._id,
      costMicros: 700,
      occurredAt: LONG_AGO,
    })
    await event(adaId, { projectId: project._id, costMicros: 300 })

    const period = (
      await get(admin, `/api/admin/cost/projects/${project._id}?window=period`)
    ).body as CostSummaryResponse

    expect(period.total.micros).toBe(300)
  })

  it('windows a lecture by its owner’s billing period', async () => {
    const project = await ProjectModel.create({
      ownerId: adaId,
      title: 'Physics',
      visibility: 'restricted',
      viewers: [],
      editors: [],
    })
    const deck = await DeckModel.create({
      ownerId: adaId,
      projectId: project._id,
      title: 'Waves',
      templateId: 'classic',
      permalinkSlug: 'waves-window01',
      slideOrder: [],
    })
    await event(adaId, {
      deckId: deck._id,
      costMicros: 700,
      occurredAt: LONG_AGO,
    })
    await event(adaId, { deckId: deck._id, costMicros: 300 })

    const period = (
      await get(admin, `/api/admin/cost/decks/${deck._id}?window=period`)
    ).body as CostSummaryResponse

    expect(period.total.micros).toBe(300)
  })

  it('404s a period request for a scope that does not exist', async () => {
    // Only the period window needs the owner; an unknown id has none to ask.
    const res = await get(
      admin,
      `/api/admin/cost/projects/${new Types.ObjectId()}?window=period`,
    )
    expect(res.status).toBe(404)
  })
})

describe('window validation', () => {
  it('rejects a window it does not know', async () => {
    const res = await get(
      admin,
      `/api/admin/cost/users/${adaId}?window=last-week`,
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })

  it('still honours a raw from/to pair when no window is named', async () => {
    await event(adaId, { costMicros: 700, occurredAt: LONG_AGO })
    await event(adaId, { costMicros: 300 })

    const res = (
      await get(
        admin,
        `/api/admin/cost/users/${adaId}?from=2019-01-01&to=2021-01-01`,
      )
    ).body as CostSummaryResponse

    expect(res.total.micros).toBe(700)
    expect(res.window!.from).toBe(new Date('2019-01-01').toISOString())
  })
})
