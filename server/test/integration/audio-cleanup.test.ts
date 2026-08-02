/**
 * Integration test for the retained-audio cleanup sweep (GEN-4 Phase 2,
 * BILL-3 retention): recordings past their owner's window have their audio
 * deleted from storage and their reference pulled from the deck; newer ones are
 * untouched, and the space is credited back to the owner's storage gauge.
 * MongoDB and local storage are real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import type { PlanTier } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { DeckModel } from '../../src/models/deck'
import { UserModel } from '../../src/models/user'
import { UsageRecordModel } from '../../src/models/usage-record'
import { adjustGauge, usedThisPeriod } from '../../src/billing/usage'
import { getStorage } from '../../src/storage'
import { sweepExpiredRecordings } from '../../src/jobs/audio-cleanup'

const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
})

afterAll(async () => {
  await disconnectMongo()
})

/** Emails this suite owns. Scoped rather than a blanket wipe: the integration
 * files share one database and run concurrently, and `admin.test.ts` paginates
 * over an exact user count — deleting everyone mid-run shifts its window. */
const OWNED_EMAILS = /^sweep-/

beforeEach(async () => {
  const mine = await UserModel.find({ email: OWNED_EMAILS }).select('_id')
  await Promise.all([
    DeckModel.deleteMany({}),
    UserModel.deleteMany({ email: OWNED_EMAILS }),
    UsageRecordModel.deleteMany({ userId: { $in: mine.map(u => u._id) } }),
  ])
})

/** A deck carrying one already-expired and one recent recording, with both
 * WAVs written to storage. Returns the deck id and the two audio keys. */
const seedDeckWithRecordings = async (
  now: number,
): Promise<{ deckId: string; oldKey: string; newKey: string }> => {
  const deck = await DeckModel.create({
    projectId: new Types.ObjectId(),
    ownerId: new Types.ObjectId(),
    templateId: 'classic',
    permalinkSlug: `sweep-${now}`,
  })
  const deckId = deck._id.toString()
  const oldKey = `audio/${deckId}/old.wav`
  const newKey = `audio/${deckId}/new.wav`
  const storage = getStorage()
  await storage.put(oldKey, Buffer.from('OLD'), 'audio/wav')
  await storage.put(newKey, Buffer.from('NEW'), 'audio/wav')
  await DeckModel.updateOne(
    { _id: deck._id },
    {
      $push: {
        recordings: {
          $each: [
            {
              sessionId: 'old',
              audioKey: oldKey,
              sampleRate: 16_000,
              durationMs: 1000,
              createdAt: new Date(now - 40 * DAY_MS),
            },
            {
              sessionId: 'new',
              audioKey: newKey,
              sampleRate: 16_000,
              durationMs: 1000,
              createdAt: new Date(now - 1 * DAY_MS),
            },
          ],
        },
      },
    },
  )
  return { deckId, oldKey, newKey }
}

describe('sweepExpiredRecordings', () => {
  it('deletes recordings past the retention window and keeps recent ones', async () => {
    const now = Date.now()
    const { deckId, oldKey, newKey } = await seedDeckWithRecordings(now)

    const removed = await sweepExpiredRecordings(30, now)
    expect(removed).toBe(1)

    // The expired blob is gone; the recent one remains.
    expect(await getStorage().get(oldKey)).toBeNull()
    expect(await getStorage().get(newKey)).not.toBeNull()

    // The deck reference is pulled for the expired recording only.
    const doc = await DeckModel.findById(deckId)
    expect(doc?.recordings).toHaveLength(1)
    expect(doc?.recordings?.[0]?.sessionId).toBe('new')
  })

  it('keeps everything when retention is disabled (0 days)', async () => {
    const now = Date.now()
    const { deckId, oldKey } = await seedDeckWithRecordings(now)

    const removed = await sweepExpiredRecordings(0, now)
    expect(removed).toBe(0)
    expect(await getStorage().get(oldKey)).not.toBeNull()
    const doc = await DeckModel.findById(deckId)
    expect(doc?.recordings).toHaveLength(2)
  })
})

/**
 * Retention is per lecture owner (BILL-3): the tier's window and the
 * deployment's compose, shortest wins.
 */
describe('sweepExpiredRecordings — per-tier windows', () => {
  /** A user on `tier` owning a deck with one recording `ageDays` old. */
  const seedOwnedRecording = async (
    tier: PlanTier,
    ageDays: number,
    now: number,
    durationMs = 60_000,
  ) => {
    const user = await UserModel.create({
      email: `sweep-${tier}-${ageDays}-${now}@example.com`,
      displayName: tier,
      passwordHash: 'x',
      planTier: tier,
    })
    const deck = await DeckModel.create({
      projectId: new Types.ObjectId(),
      ownerId: user._id,
      templateId: 'classic',
      permalinkSlug: `tier-${tier}-${ageDays}-${now}`,
    })
    const audioKey = `audio/${deck._id.toString()}/rec.pcm`
    await getStorage().put(audioKey, Buffer.from('AUDIO'), 'audio/L16')
    await DeckModel.updateOne(
      { _id: deck._id },
      {
        $push: {
          recordings: {
            sessionId: 'r1',
            audioKey,
            sampleRate: 16_000,
            durationMs,
            createdAt: new Date(now - ageDays * DAY_MS),
          },
        },
      },
    )
    return {
      userId: user._id.toString(),
      deckId: deck._id.toString(),
      audioKey,
    }
  }

  it('expires a Free owner’s audio on the tier’s shorter window', async () => {
    const now = Date.now()
    // Ten days old: past Free's 7-day window, well inside the deployment's 30.
    const { deckId } = await seedOwnedRecording('free', 10, now)

    expect(await sweepExpiredRecordings(30, now)).toBe(1)
    expect((await DeckModel.findById(deckId))?.recordings).toHaveLength(0)
  })

  it('keeps a Pro owner’s audio of the same age', async () => {
    const now = Date.now()
    // The same ten days, but Pro keeps 21 — the tier is what differs.
    const { deckId } = await seedOwnedRecording('pro', 10, now)

    expect(await sweepExpiredRecordings(30, now)).toBe(0)
    expect((await DeckModel.findById(deckId))?.recordings).toHaveLength(1)
  })

  it('lets a tighter deployment window override a generous tier', async () => {
    const now = Date.now()
    const { deckId } = await seedOwnedRecording('pro', 10, now)

    // An operator who keeps audio for three days means it, whatever Pro allows.
    expect(await sweepExpiredRecordings(3, now)).toBe(1)
    expect((await DeckModel.findById(deckId))?.recordings).toHaveLength(0)
  })

  it('credits the freed space back to the owner’s storage gauge', async () => {
    const now = Date.now()
    // One minute of LINEAR16 mono at 16 kHz = 1,920,000 bytes ≈ 1.831 MB.
    const { userId } = await seedOwnedRecording('free', 10, now, 60_000)
    await adjustGauge(userId, 'audioStorageMb', 10)

    await sweepExpiredRecordings(30, now)

    const held = await usedThisPeriod(userId, 'audioStorageMb')
    expect(held).toBeCloseTo(10 - (60_000 / 1000) * 16_000 * 2 * 2 ** -20, 4)
  })

  it('never drives the gauge below zero', async () => {
    // A sweep that runs twice, or a credit that arrives after a purge already
    // gave the space back, must leave the user at nothing rather than owing.
    const now = Date.now()
    const { userId } = await seedOwnedRecording('free', 10, now, 60_000)

    await sweepExpiredRecordings(30, now)

    expect(await usedThisPeriod(userId, 'audioStorageMb')).toBe(0)
  })
})
