/**
 * Integration test for the retained-audio cleanup sweep (GEN-4 Phase 2):
 * recordings older than AUDIO_RETENTION_DAYS have their WAV deleted from
 * storage and their reference pulled from the deck; newer ones are untouched.
 * MongoDB and local storage are real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { DeckModel } from '../../src/models/deck'
import { getStorage } from '../../src/storage'
import { sweepExpiredRecordings } from '../../src/jobs/audio-cleanup'

const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await DeckModel.deleteMany({})
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
