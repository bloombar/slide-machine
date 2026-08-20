/**
 * Integration tests for ledger retention (BILL-7/P-11).
 *
 * The behaviour worth protecting is the *ordering*: summarize a month, write
 * the roll-up, and only then delete the events behind it. A sweep that deleted
 * first would lose detail nothing can reconstruct, and no test of the totals
 * alone would notice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { CostEventModel } from '../../src/models/cost-event'
import { CostRollupModel } from '../../src/models/cost-rollup'
import { rollUpExpiredCostEvents } from '../../src/jobs/cost-rollup'

const ada = new Types.ObjectId()
const viewer = new Types.ObjectId()
const deckId = new Types.ObjectId()

const DAY = 86_400_000

const event = async (occurredAt: Date, over: Record<string, unknown> = {}) =>
  CostEventModel.create({
    payerId: ada,
    actorId: ada,
    actorKind: 'owner',
    deckId,
    deckName: 'Standing waves',
    metric: 'aiTokens',
    quantity: 1000,
    billable: true,
    costMicros: 1000,
    currency: 'USD',
    occurredAt,
    ...over,
  })

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([CostEventModel.init(), CostRollupModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    CostEventModel.deleteMany({}),
    CostRollupModel.deleteMany({}),
  ])
})

/** A date safely inside a month that is wholly older than `days`. */
const monthsAgo = (n: number): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15))
}

describe('rolling a month up', () => {
  it('summarizes an expired month and removes its events', async () => {
    await event(monthsAgo(3), { costMicros: 700 })
    await event(monthsAgo(3), {
      actorKind: 'audience',
      actorId: viewer,
      costMicros: 300,
      metric: 'audienceTtsCharacters',
    })

    const result = await rollUpExpiredCostEvents(30)
    expect(result.rollups).toBeGreaterThan(0)
    expect(result.deleted).toBe(2)
    expect(await CostEventModel.countDocuments({})).toBe(0)

    const rollup = await CostRollupModel.findOne({ payerId: ada })
    expect(rollup?.instructorMicros).toBe(700)
    expect(rollup?.audienceMicros).toBe(300)
    // The lecture is still nameable after its events are gone, which is the
    // whole reason the name is denormalized in the first place.
    expect(rollup?.deckName).toBe('Standing waves')
    expect(rollup?.registeredStudents).toBe(1)
  })

  it('keeps per-metric quantities so an aged month still breaks down', async () => {
    await event(monthsAgo(3), { metric: 'sttMinutes', quantity: 60 })
    await event(monthsAgo(3), { metric: 'sttMinutes', quantity: 30 })
    await rollUpExpiredCostEvents(30)

    const rollup = await CostRollupModel.findOne({ payerId: ada })
    const stt = rollup?.byMetric.find(m => m.metric === 'sttMinutes')
    expect(stt?.quantity).toBe(90)
    expect(stt?.events).toBe(2)
  })

  it('counts cached events in the roll-up, so the ratio survives', async () => {
    await event(monthsAgo(3), { billable: true })
    await event(monthsAgo(3), { billable: false, costMicros: 0 })
    await rollUpExpiredCostEvents(30)

    const rollup = await CostRollupModel.findOne({ payerId: ada })
    const ai = rollup?.byMetric.find(m => m.metric === 'aiTokens')
    expect(ai?.events).toBe(2)
    expect(ai?.cachedEvents).toBe(1)
  })
})

describe('what it refuses to touch', () => {
  it('leaves recent events alone', async () => {
    await event(new Date(Date.now() - 2 * DAY))
    const result = await rollUpExpiredCostEvents(30)
    expect(result.deleted).toBe(0)
    expect(await CostEventModel.countDocuments({})).toBe(1)
  })

  it('never rolls up the month in progress', async () => {
    // Still being written to; a summary of it would be wrong immediately.
    await event(new Date())
    // Even an absurd cutoff must not reach it.
    const result = await rollUpExpiredCostEvents(0.0001)
    expect(await CostEventModel.countDocuments({})).toBe(1)
    expect(result.deleted).toBe(0)
  })

  it('does nothing at all when retention is disabled', async () => {
    await event(monthsAgo(6))
    const result = await rollUpExpiredCostEvents(0)
    expect(result).toEqual({ months: 0, rollups: 0, deleted: 0 })
    expect(await CostEventModel.countDocuments({})).toBe(1)
  })
})

describe('running twice', () => {
  it('replaces a month rather than doubling it', async () => {
    await event(monthsAgo(3), { costMicros: 500 })
    await rollUpExpiredCostEvents(30)
    // A second pass finds nothing left to roll up, and must not have
    // duplicated what the first wrote.
    await rollUpExpiredCostEvents(30)

    expect(await CostRollupModel.countDocuments({})).toBe(1)
    const rollup = await CostRollupModel.findOne({})
    expect(rollup?.instructorMicros).toBe(500)
  })

  it('catches up across several months in one sweep', async () => {
    await event(monthsAgo(4))
    await event(monthsAgo(3))
    await event(monthsAgo(2))
    const result = await rollUpExpiredCostEvents(30)
    expect(result.months).toBe(3)
    expect(await CostEventModel.countDocuments({})).toBe(0)
  })
})
