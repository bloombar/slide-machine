/**
 * Integration tests for narration reference counting (P-11).
 *
 * Synthesized narration is cached under a hash of the words spoken, so two
 * lectures saying the same thing in the same voice share one stored file. The
 * reference index records which decks play each object; the purge deletes an
 * object only once the last of them is gone. MongoDB and local storage are
 * real, and the mock TTS provider synthesizes silent audio so the full
 * play → store → share → purge path runs offline.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import { randomUUID } from 'node:crypto'

// Force the mock TTS adapter — this suite must never reach a paid API.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, TTS_PROVIDER: 'mock' } }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  TtsObjectModel,
  releaseTtsObjects,
  retainTtsObject,
} from '../../src/models/tts-object'
import { purgeDeckCascade } from '../../src/lib/cascade'
import { getStorage } from '../../src/storage'

const server = createApp().listen(0)

/** Rows and users this suite owns. The integration files share one database and
 * run concurrently, so nothing here may wipe a collection wholesale. */
const OWNED_KEYS = /^tts\/refcount-/
const OWNED_EMAILS = /^refcount-/

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => {
  server.close()
  await disconnectMongo()
})

beforeEach(async () => {
  const mine = await UserModel.find({ email: OWNED_EMAILS }).select('_id')
  const userIds = mine.map(u => u._id)
  const decks = await DeckModel.find({ ownerId: { $in: userIds } }).select(
    '_id',
  )
  const deckIds = decks.map(d => d._id)
  await Promise.all([
    SlideModel.deleteMany({ deckId: { $in: deckIds } }),
    DeckModel.deleteMany({ _id: { $in: deckIds } }),
    ProjectModel.deleteMany({ ownerId: { $in: userIds } }),
    RefreshTokenModel.deleteMany({ userId: { $in: userIds } }),
    TtsObjectModel.deleteMany({
      $or: [{ storageKey: OWNED_KEYS }, { deckIds: { $in: deckIds } }],
    }),
    UserModel.deleteMany({ email: OWNED_EMAILS }),
  ])
})

/** A distinct pair of cache keys per test, so nothing collides on disk. */
const keysFor = (name: string) => ({
  storageKey: `tts/refcount-${name}-${randomUUID()}.wav`,
  marksKey: `tts/refcount-${name}-marks.json`,
})

// ─── The index itself ───────────────────────────────────────────────────────

describe('retainTtsObject', () => {
  it('records the first deck to play an object', async () => {
    const keys = keysFor('first')
    const deckId = new Types.ObjectId()
    await retainTtsObject(keys, deckId)

    const row = await TtsObjectModel.findOne({ storageKey: keys.storageKey })
    expect(row?.marksKey).toBe(keys.marksKey)
    expect(row?.deckIds.map(String)).toEqual([deckId.toString()])
  })

  // Every playback retains, including the replays a cache hit serves, so this
  // runs far more often than it inserts.
  it('is idempotent — replaying does not stack references', async () => {
    const keys = keysFor('replay')
    const deckId = new Types.ObjectId()
    await retainTtsObject(keys, deckId)
    await retainTtsObject(keys, deckId)
    await retainTtsObject(keys, deckId)

    const row = await TtsObjectModel.findOne({ storageKey: keys.storageKey })
    expect(row?.deckIds).toHaveLength(1)
  })

  it('adds a second deck that reaches the same audio', async () => {
    const keys = keysFor('shared')
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()]
    await retainTtsObject(keys, a)
    await retainTtsObject(keys, b)

    const row = await TtsObjectModel.findOne({ storageKey: keys.storageKey })
    expect(row?.deckIds.map(String).sort()).toEqual(
      [a.toString(), b.toString()].sort(),
    )
  })
})

describe('releaseTtsObjects', () => {
  it('keeps shared audio alive until its last lecture goes', async () => {
    const keys = keysFor('last-one-out')
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()]
    await retainTtsObject(keys, a)
    await retainTtsObject(keys, b)

    // First lecture purged: nothing to delete, because the second still plays it.
    expect(await releaseTtsObjects([a])).toEqual([])
    const still = await TtsObjectModel.findOne({ storageKey: keys.storageKey })
    expect(still?.deckIds.map(String)).toEqual([b.toString()])

    // Second lecture purged: both the audio and its sidecar are now orphaned.
    expect((await releaseTtsObjects([b])).sort()).toEqual(
      [keys.storageKey, keys.marksKey].sort(),
    )
    expect(
      await TtsObjectModel.findOne({ storageKey: keys.storageKey }),
    ).toBeNull()
  })

  it('releases several decks at once, reporting a shared object once', async () => {
    const keys = keysFor('project-wide')
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()]
    await retainTtsObject(keys, a)
    await retainTtsObject(keys, b)

    // A project or account purge hands over every deck together.
    const orphaned = await releaseTtsObjects([a, b])
    expect(orphaned.sort()).toEqual([keys.storageKey, keys.marksKey].sort())
  })

  it('leaves objects belonging to other decks untouched', async () => {
    const mine = keysFor('mine')
    const theirs = keysFor('theirs')
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()]
    await retainTtsObject(mine, a)
    await retainTtsObject(theirs, b)

    expect(await releaseTtsObjects([a])).toEqual([
      mine.storageKey,
      mine.marksKey,
    ])
    expect(
      await TtsObjectModel.findOne({ storageKey: theirs.storageKey }),
    ).not.toBeNull()
  })

  it('accepts deck ids as strings, as the purge cascade passes them', async () => {
    const keys = keysFor('string-ids')
    const deckId = new Types.ObjectId()
    await retainTtsObject(keys, deckId)

    expect((await releaseTtsObjects([deckId.toString()])).sort()).toEqual(
      [keys.storageKey, keys.marksKey].sort(),
    )
  })

  it('is a no-op for decks that never played anything', async () => {
    expect(await releaseTtsObjects([new Types.ObjectId()])).toEqual([])
    expect(await releaseTtsObjects([])).toEqual([])
  })
})

// ─── The purge cascade ──────────────────────────────────────────────────────

describe('purging a lecture', () => {
  /** A deck owned by this suite, with no content of its own. */
  const makeDeck = async (slug: string) => {
    const owner = await UserModel.create({
      email: `refcount-${slug}@example.com`,
      displayName: 'Ada',
    })
    const project = await ProjectModel.create({
      ownerId: owner._id,
      title: 'Bio',
    })
    return DeckModel.create({
      ownerId: owner._id,
      projectId: project._id,
      title: 'L1',
      templateId: 'classic',
      permalinkSlug: `refcount-${slug}-${randomUUID()}`,
    })
  }

  it('deletes narration no surviving lecture plays', async () => {
    const storage = getStorage()
    const keys = keysFor('purge-solo')
    await storage.put(keys.storageKey, Buffer.from('AUDIO'), 'audio/wav')
    await storage.put(keys.marksKey, Buffer.from('[]'), 'application/json')
    const deck = await makeDeck('solo')
    await retainTtsObject(keys, deck._id)

    await purgeDeckCascade(deck._id)

    expect(await storage.get(keys.storageKey)).toBeFalsy()
    expect(await storage.get(keys.marksKey)).toBeFalsy()
  })

  it('spares narration another lecture still plays', async () => {
    const storage = getStorage()
    const keys = keysFor('purge-shared')
    await storage.put(keys.storageKey, Buffer.from('AUDIO'), 'audio/wav')
    const [first, second] = [
      await makeDeck('shared-a'),
      await makeDeck('shared-b'),
    ]
    await retainTtsObject(keys, first._id)
    await retainTtsObject(keys, second._id)

    await purgeDeckCascade(first._id)
    // The audio the second lecture depends on is still there — this is the
    // regression the reference index exists to prevent.
    expect(await storage.get(keys.storageKey)).toBeTruthy()

    await purgeDeckCascade(second._id)
    expect(await storage.get(keys.storageKey)).toBeFalsy()
  })
})

// ─── End to end, through the playback route ─────────────────────────────────

describe('playback through the route', () => {
  const registerUser = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email, password: 'longenough1', displayName: 'Ada' })
    if (res.status !== 201)
      throw new Error(`registration failed: ${res.status}`)
    return res.body.accessToken as string
  }

  const act = (token: string, name: string, input: object = {}) =>
    request(server)
      .post(`/api/actions/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .send(input)

  const speak = (token: string, slideId: string) =>
    request(server)
      .post(`/api/slides/${slideId}/tts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'transcript' })

  it('registers both lectures that speak the same words, then frees the file with the last of them', async () => {
    const token = await registerUser('refcount-route@example.com')
    const project = await act(token, 'project.create', { title: 'Bio' })
    // The same sentence in two lectures hashes to one cached object; the
    // random tail keeps it distinct from other runs' audio on disk.
    const narration = `Shared narration ${randomUUID()}.`

    const deckIds: string[] = []
    for (const title of ['L1', 'L2']) {
      const deck = await act(token, 'deck.create', {
        projectId: project.body.id,
        title,
        templateId: 'classic',
      })
      deckIds.push(deck.body.id)
      const slide = await SlideModel.create({
        deckId: new Types.ObjectId(deck.body.id),
        index: 0,
        layoutType: 'content',
        title,
        sourceTranscript: narration,
      })
      const res = await speak(token, slide._id.toString())
      expect(res.status).toBe(200)
      expect(res.body.url).toMatch(/\.wav$/)
    }

    // One object, two references: the second lecture was served from cache and
    // still came away holding a claim on the file.
    const rows = await TtsObjectModel.find({
      deckIds: { $in: deckIds.map(id => new Types.ObjectId(id)) },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.deckIds.map(String).sort()).toEqual([...deckIds].sort())

    const storage = getStorage()
    const { storageKey } = rows[0]!
    expect(await storage.get(storageKey)).toBeTruthy()

    await purgeDeckCascade(deckIds[0]!)
    expect(await storage.get(storageKey)).toBeTruthy()

    await purgeDeckCascade(deckIds[1]!)
    expect(await storage.get(storageKey)).toBeFalsy()
    expect(await TtsObjectModel.findOne({ storageKey })).toBeNull()
  })
})
