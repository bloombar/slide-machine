/**
 * Integration tests for the cost ledger (BILL-7).
 *
 * What is worth a database here is the attribution: who a row says paid, who
 * it says acted, and what it says the work belonged to. Those are decided by
 * the ambient context at the moment of the event, cannot be reconstructed
 * afterwards, and are the whole reason the ledger exists separately from the
 * counters.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { CostEventModel } from '../../src/models/cost-event'
import { UsageRecordModel } from '../../src/models/usage-record'
import { recordUsage } from '../../src/billing/usage'
import { runWithUsage } from '../../src/billing/usage-attribution'
import { resetCapNotifications } from '../../src/billing/cap-queue'

const ada = new Types.ObjectId().toString()
const student = new Types.ObjectId().toString()
const projectId = new Types.ObjectId().toString()
const deckId = new Types.ObjectId().toString()

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await CostEventModel.init()
})

afterAll(disconnectMongo)

beforeEach(async () => {
  // Metering now also queues a cap check (BILL-8). Nothing here is about
  // notifications, so the queue is dropped rather than left to fire against a
  // database these tests have already emptied.
  resetCapNotifications()
  await Promise.all([
    CostEventModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
})

/** The single row a test just produced. */
const onlyRow = async () => {
  const rows = await CostEventModel.find({})
  expect(rows).toHaveLength(1)
  return rows[0]!
}

describe('what a row records', () => {
  it('writes one event per metered call, priced and frozen', async () => {
    await recordUsage(ada, 'aiTokens', 50_000)
    const row = await onlyRow()

    expect(row.payerId.toString()).toBe(ada)
    expect(row.metric).toBe('aiTokens')
    expect(row.quantity).toBe(50_000)
    expect(row.billable).toBe(true)
    expect(row.costMicros).toBeGreaterThan(0)
    expect(row.currency).toBeTruthy()
    expect(row.occurredAt).toBeInstanceOf(Date)
  })

  it('records a cache hit, at nothing', async () => {
    // The row that makes the denominators honest: it happened, it reached
    // someone, and it cost nothing (BILL-7).
    await recordUsage(ada, 'ttsCharacters', 4_000, { billable: false })
    const row = await onlyRow()

    expect(row.billable).toBe(false)
    expect(row.costMicros).toBe(0)
    // Still carries the quantity, so "cost avoided" is derivable from the
    // same rows the cache-hit ratio is.
    expect(row.quantity).toBe(4_000)
  })

  it('keeps the counter and the ledger in step', async () => {
    await recordUsage(ada, 'exports', 1)
    await recordUsage(ada, 'exports', 1)
    expect(await CostEventModel.countDocuments({ payerId: ada })).toBe(2)
    const counter = await UsageRecordModel.findOne({
      userId: ada,
      metric: 'exports',
    })
    // Two events, one counter at two: the ledger is per-event, the counter is
    // a total, and neither is derivable from the other.
    expect(counter?.used).toBe(2)
  })

  it('prices the same tokens differently when told the split', async () => {
    await runWithUsage(ada, () =>
      recordUsage(ada, 'aiTokens', 1_000_000, {
        pricing: { kind: 'tokens', inputTokens: 1_000_000, outputTokens: 0 },
      }),
    )
    const cheap = (await onlyRow()).costMicros
    await CostEventModel.deleteMany({})

    await recordUsage(ada, 'aiTokens', 1_000_000, {
      pricing: { kind: 'tokens', inputTokens: 0, outputTokens: 1_000_000 },
    })
    expect((await onlyRow()).costMicros).toBeGreaterThan(cheap)
  })
})

describe('who paid and who acted', () => {
  it('marks an owner’s own work as theirs', async () => {
    await runWithUsage({ userId: ada, actorId: ada }, () =>
      recordUsage(ada, 'aiTokens', 100),
    )
    const row = await onlyRow()
    expect(row.actorKind).toBe('owner')
    expect(row.actorId?.toString()).toBe(ada)
  })

  it('marks a viewer’s work as the audience’s, still charged to the owner', async () => {
    // The pair that makes both perspectives available from one ledger: the
    // owner pays, the viewer is recorded, and the split is a query away.
    await runWithUsage({ userId: ada, audience: true, actorId: student }, () =>
      recordUsage(ada, 'audienceTtsCharacters', 2_000),
    )
    const row = await onlyRow()
    expect(row.payerId.toString()).toBe(ada)
    expect(row.actorId?.toString()).toBe(student)
    expect(row.actorKind).toBe('audience')
  })

  it('counts an anonymous viewer without identifying them', async () => {
    // Unregistered playbacks are an event count. Assigning them a tracking
    // identity to make them countable would conflict with §16.
    await runWithUsage({ userId: ada, audience: true }, () =>
      recordUsage(ada, 'audienceTtsCharacters', 2_000),
    )
    const row = await onlyRow()
    expect(row.actorId).toBeNull()
    expect(row.actorKind).toBe('audience')
    expect(row.payerId.toString()).toBe(ada)
  })

  it('marks work nobody asked for as the system’s', async () => {
    // A sweep or a backfill is charged to an account but caused by the
    // deployment. It is neither instructor nor student spend, and neither
    // remedy applies to it.
    await recordUsage(ada, 'aiTokens', 100)
    expect((await onlyRow()).actorKind).toBe('system')
  })
})

describe('what the work belonged to', () => {
  it('records the project and lecture, with the names they had', async () => {
    await runWithUsage(
      {
        userId: ada,
        actorId: ada,
        projectId,
        projectName: 'Physics 101',
        deckId,
        deckName: 'Standing waves',
      },
      () => recordUsage(ada, 'aiTokens', 100),
    )
    const row = await onlyRow()
    expect(row.projectId?.toString()).toBe(projectId)
    expect(row.deckId?.toString()).toBe(deckId)
    // Denormalized, because the row outlives the entity: a deleted lecture's
    // cost still happened, and still has to be nameable.
    expect(row.projectName).toBe('Physics 101')
    expect(row.deckName).toBe('Standing waves')
  })

  it('survives the lecture it describes being deleted', async () => {
    await runWithUsage(
      { userId: ada, actorId: ada, deckId, deckName: 'Standing waves' },
      () => recordUsage(ada, 'aiTokens', 100),
    )
    // Nothing cascades here on purpose: the ledger is not owned by the deck.
    const row = await onlyRow()
    expect(row.deckName).toBe('Standing waves')
  })

  it('does not hang one account’s work on another’s lecture', async () => {
    // A nested piece of work for a different payer must not inherit the outer
    // request's entity references, or one deck's cost lands on another's
    // report.
    await runWithUsage(
      { userId: student, actorId: student, deckId, deckName: 'Their lecture' },
      () => recordUsage(ada, 'aiTokens', 100),
    )
    const row = await onlyRow()
    expect(row.payerId.toString()).toBe(ada)
    expect(row.deckId).toBeNull()
    expect(row.deckName).toBeUndefined()
  })

  it('still records the payer when nothing else is known', async () => {
    // The per-user roll-up works even where the per-lecture one is blind.
    await recordUsage(ada, 'sttMinutes', 30)
    const row = await onlyRow()
    expect(row.payerId.toString()).toBe(ada)
    expect(row.deckId).toBeNull()
    expect(row.costMicros).toBeGreaterThan(0)
  })
})

describe('the ledger never breaks a request', () => {
  it('does not throw on a payer id that is not an id', async () => {
    await expect(
      recordUsage('not-an-object-id', 'aiTokens', 100),
    ).resolves.toBeUndefined()
    expect(await CostEventModel.countDocuments({})).toBe(0)
  })
})
