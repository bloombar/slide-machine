/**
 * Integration tests for the de-identified research export (SPEC EVAL-2):
 * the bundle's files and columns, the study-id pseudonymization (present,
 * consistent across files, stable across exports, and never accompanied by
 * a user id, email, or display name), window behavior including the
 * lecture-union rule, tombstone handling, and the admin gate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import AdmZip from 'adm-zip'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { errorHandler } from '../../src/middleware/error'
import { UserModel } from '../../src/models/user'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { SessionTelemetryEventModel } from '../../src/models/session-telemetry-event'
import { VoteModel } from '../../src/models/vote'
import { CostEventModel } from '../../src/models/cost-event'
import { DeckViewModel } from '../../src/models/deck-view'
import { ensureStudyIds } from '../../src/research/study-id'
import { signAccessToken } from '../../src/auth/tokens'

const ADMIN_EMAIL = 'admin@example.com'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use(errorHandler)
const server = app.listen(0)

let adminToken: string

/** Fetches a path as raw bytes (supertest's default parser is text). */
const getRaw = (path: string) =>
  request(server)
    .get(path)
    .set('Authorization', `Bearer ${adminToken}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })

/** Downloads the bundle and indexes its entries by name. */
const getBundle = async (query = ''): Promise<Map<string, string>> => {
  const res = await getRaw(`/api/admin/research/export${query}`)
  expect(res.status).toBe(200)
  expect(res.headers['content-type']).toContain('application/zip')
  const zip = new AdmZip(res.body as Buffer)
  return new Map(
    zip.getEntries().map(e => [e.entryName, e.getData().toString('utf-8')]),
  )
}

/** Parses one CSV file into rows of raw fields — enough for these fixtures,
 * which never embed commas in the fields under test. */
const rows = (csv: string): string[][] =>
  csv
    .trim()
    .split('\r\n')
    .map(line => line.split(','))

/** Column values of a CSV, keyed by header name, one entry per data row. */
const column = (csv: string, name: string): string[] => {
  const [header, ...data] = rows(csv)
  const at = header!.indexOf(name)
  expect(at).toBeGreaterThanOrEqual(0)
  return data.map(row => row[at]!)
}

const makeUser = (over: Record<string, unknown> = {}) =>
  UserModel.create({
    email: `user-${new Types.ObjectId().toString()}@example.com`,
    displayName: 'Some Person',
    ...over,
  })

const makeDeck = async (
  ownerId: Types.ObjectId,
  over: Record<string, unknown> = {},
) =>
  DeckModel.create({
    ownerId,
    projectId: new Types.ObjectId(),
    templateId: 'classic',
    permalinkSlug: `slug-${new Types.ObjectId().toString()}`,
    title: 'Osmosis',
    ...over,
  })

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    SessionTelemetryEventModel.deleteMany({}),
    VoteModel.deleteMany({}),
    CostEventModel.deleteMany({}),
    DeckViewModel.deleteMany({}),
  ])
  const admin = await UserModel.create({
    email: ADMIN_EMAIL,
    displayName: 'Admin',
  })
  adminToken = await signAccessToken(admin._id.toString())
})

describe('study ids', () => {
  it('assigns an id once and returns the same one ever after', async () => {
    const user = await makeUser()
    const first = await ensureStudyIds([user._id])
    const again = await ensureStudyIds([user._id.toString()])
    const id = first.get(user._id.toString())
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(again.get(user._id.toString())).toBe(id)
  })

  it('covers soft-deleted accounts and skips purged ones', async () => {
    const gone = await makeUser({ deletedAt: new Date() })
    const purged = new Types.ObjectId()
    const map = await ensureStudyIds([gone._id, purged])
    expect(map.get(gone._id.toString())).toMatch(/^[0-9a-f]{16}$/)
    expect(map.has(purged.toString())).toBe(false)
  })

  it('gives distinct accounts distinct ids', async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()])
    const map = await ensureStudyIds([a!._id, b!._id])
    expect(map.get(a!._id.toString())).not.toBe(map.get(b!._id.toString()))
  })
})

describe('the bundle', () => {
  it('contains the README and one CSV per dataset', async () => {
    const bundle = await getBundle()
    expect([...bundle.keys()].sort()).toEqual([
      'README.md',
      'cost-events.csv',
      'deck-views.csv',
      'lectures.csv',
      'session-telemetry.csv',
      'slides.csv',
      'transcript-segments.csv',
      'votes.csv',
    ])
    expect(bundle.get('README.md')).toContain('pseudonymous, not anonymous')
  })

  it('keys every file by study id and leaks no identity', async () => {
    const owner = await makeUser({
      email: 'leaky@example.com',
      displayName: 'Leaky Name',
    })
    const voter = await makeUser({ email: 'voter@example.com' })
    const deck = await makeDeck(owner._id, { studyLabel: 'condition-A' })
    await SlideModel.create({
      deckId: deck._id,
      index: 0,
      layoutType: 'title',
      title: 'Cells',
    })
    await TranscriptSegmentModel.create({
      deckId: deck._id,
      sessionId: 'sess-1',
      text: 'water crosses the membrane',
      action: 'new',
      words: [{ word: 'water', startMs: 0, endMs: 300 }],
    })
    await VoteModel.create({
      userId: voter._id,
      targetType: 'deck',
      targetId: deck._id,
      value: 1,
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorId: voter._id,
      actorKind: 'audience',
      deckId: deck._id,
      deckName: deck.title,
      metric: 'sttMinutes',
      quantity: 3,
      billable: true,
      costMicros: 1_500_000,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    const everything = [...bundle.values()].join('\n')

    // No identity, anywhere: not the emails, names, or account ids.
    expect(everything).not.toContain('leaky@example.com')
    expect(everything).not.toContain('voter@example.com')
    expect(everything).not.toContain('Leaky Name')
    expect(everything).not.toContain(owner._id.toString())
    expect(everything).not.toContain(voter._id.toString())

    // The same account carries the same pseudonym in every file.
    const map = await ensureStudyIds([owner._id, voter._id])
    const ownerSid = map.get(owner._id.toString())!
    const voterSid = map.get(voter._id.toString())!
    expect(column(bundle.get('lectures.csv')!, 'ownerStudyId')).toEqual([
      ownerSid,
    ])
    expect(column(bundle.get('votes.csv')!, 'voterStudyId')).toEqual([voterSid])
    expect(column(bundle.get('cost-events.csv')!, 'payerStudyId')).toEqual([
      ownerSid,
    ])
    expect(column(bundle.get('cost-events.csv')!, 'actorStudyId')).toEqual([
      voterSid,
    ])

    // Content that IS meant to leave as-is left as-is.
    expect(column(bundle.get('lectures.csv')!, 'studyLabel')).toEqual([
      'condition-A',
    ])
    expect(bundle.get('slides.csv')).toContain('Cells')
    expect(bundle.get('transcript-segments.csv')).toContain(
      'water crosses the membrane',
    )
    // Word timings stay home; only their count travels.
    expect(column(bundle.get('transcript-segments.csv')!, 'wordCount')).toEqual(
      ['1'],
    )
  })

  it('keeps pseudonyms stable across exports', async () => {
    const owner = await makeUser()
    await makeDeck(owner._id)
    const first = await getBundle()
    const second = await getBundle()
    expect(column(first.get('lectures.csv')!, 'ownerStudyId')).toEqual(
      column(second.get('lectures.csv')!, 'ownerStudyId'),
    )
  })

  it('carries the published quiz reference on the lecture row', async () => {
    const owner = await makeUser()
    await makeDeck(owner._id, {
      quiz: {
        formId: 'form-123',
        formUrl: 'https://forms.example/form-123',
        driveFolderId: 'folder-1',
        publishedAt: new Date('2026-03-01T00:00:00Z'),
      },
    })
    const bundle = await getBundle()
    expect(column(bundle.get('lectures.csv')!, 'quizFormId')).toEqual([
      'form-123',
    ])
  })

  it('renders an anonymous cost actor as blank, not withheld', async () => {
    const owner = await makeUser()
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'audience',
      metric: 'ttsCharacters',
      quantity: 10,
      billable: false,
      costMicros: 0,
      currency: 'USD',
      occurredAt: new Date(),
    })
    const bundle = await getBundle()
    expect(column(bundle.get('cost-events.csv')!, 'actorStudyId')).toEqual([''])
  })

  it('exports the language a lecture was read or heard in', async () => {
    const owner = await makeUser()
    const reader = await makeUser({ email: 'reader@example.com' })
    const deck = await makeDeck(owner._id)
    // One reading in Mandarin, and one piece of work with no language at all.
    // Both belong in the bundle; only the first one has a language, and the
    // second must come out blank rather than defaulting to English.
    await CostEventModel.create({
      payerId: owner._id,
      actorId: reader._id,
      actorKind: 'audience',
      deckId: deck._id,
      deckName: deck.title,
      locale: 'zh',
      metric: 'audienceLocales',
      quantity: 0,
      billable: false,
      costMicros: 0,
      currency: 'USD',
      occurredAt: new Date(),
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      deckId: deck._id,
      metric: 'sttMinutes',
      quantity: 3,
      billable: true,
      costMicros: 1_500_000,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    expect(column(bundle.get('cost-events.csv')!, 'locale').sort()).toEqual([
      '',
      'zh',
    ])
    expect(bundle.get('README.md')).toContain('read or heard in')
  })

  it('exports lecture openings, naming only the readers who signed in', async () => {
    const owner = await makeUser()
    const reader = await makeUser({ email: 'reader@example.com' })
    const deck = await makeDeck(owner._id)
    await DeckViewModel.create({
      deckId: deck._id,
      deckName: deck.title,
      ownerId: owner._id,
      viewerId: reader._id,
      actorKind: 'audience',
      channel: 'app',
      occurredAt: new Date(),
    })
    await DeckViewModel.create({
      deckId: deck._id,
      deckName: deck.title,
      ownerId: owner._id,
      viewerId: null,
      actorKind: 'audience',
      channel: 'app',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    const viewers = column(bundle.get('deck-views.csv')!, 'viewerStudyId')
    expect(viewers).toHaveLength(2)
    // A signed-out reader is a blank cell, which is the honest rendering:
    // there is no identity here rather than one being withheld (§16).
    expect(viewers.filter(v => v === '')).toHaveLength(1)
    const named = viewers.filter(v => v !== '')
    expect(named).toHaveLength(1)
    // Pseudonymized like every other identity in the bundle (P-14).
    expect(named[0]).not.toBe(reader._id.toString())
    expect(bundle.get('README.md')).toContain('deck-views.csv')
  })

  it('exports tombstoned lectures marked by deletedAt', async () => {
    const owner = await makeUser()
    await makeDeck(owner._id, { deletedAt: new Date() })
    const bundle = await getBundle()
    const deleted = column(bundle.get('lectures.csv')!, 'deletedAt')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).not.toBe('')
  })
})

describe('the window', () => {
  it('bounds each dataset by its own timestamp', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    const past = new Date(Date.now() - 3_600_000)
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      deckId: deck._id,
      metric: 'sttMinutes',
      quantity: 1,
      billable: true,
      costMicros: 100,
      currency: 'USD',
      occurredAt: past,
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      deckId: deck._id,
      metric: 'sttMinutes',
      quantity: 2,
      billable: true,
      costMicros: 200,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const from = new Date(Date.now() - 1_800_000).toISOString()
    const bundle = await getBundle(`?from=${encodeURIComponent(from)}`)
    expect(column(bundle.get('cost-events.csv')!, 'quantity')).toEqual(['2'])
  })

  it('unions in a lecture referenced only by in-window activity', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // The lecture predates the window; only its telemetry falls inside.
    const future = new Date(Date.now() + 3_600_000)
    await SessionTelemetryEventModel.create({
      sessionId: 'sess-later',
      deckId: deck._id,
      kind: 'session_start',
      at: new Date(future.getTime() + 60_000),
    })

    const bundle = await getBundle(
      `?from=${encodeURIComponent(future.toISOString())}`,
    )
    expect(column(bundle.get('lectures.csv')!, 'deckId')).toEqual([
      deck._id.toString(),
    ])
  })

  it('unions in a lecture whose only in-window activity is being opened', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // The lecture predates the window; only the opening falls inside. A
    // reader who opened an older lecture must still find a row to join to.
    const future = new Date(Date.now() + 3_600_000)
    await DeckViewModel.create({
      deckId: deck._id,
      deckName: deck.title,
      ownerId: owner._id,
      viewerId: null,
      actorKind: 'audience',
      channel: 'app',
      occurredAt: new Date(future.getTime() + 60_000),
    })

    const bundle = await getBundle(
      `?from=${encodeURIComponent(future.toISOString())}`,
    )
    expect(column(bundle.get('lectures.csv')!, 'deckId')).toEqual([
      deck._id.toString(),
    ])
    expect(column(bundle.get('deck-views.csv')!, 'deckId')).toEqual([
      deck._id.toString(),
    ])
  })

  it('exports only slides of bundled lectures', async () => {
    const owner = await makeUser()
    const bundled = await makeDeck(owner._id)
    await SlideModel.create({
      deckId: bundled._id,
      index: 0,
      layoutType: 'title',
      title: 'kept',
    })
    // A slide of a lecture outside the window has no lecture row to join
    // against, so it stays out too.
    const outside = await makeDeck(owner._id)
    await SlideModel.create({
      deckId: outside._id,
      index: 0,
      layoutType: 'title',
      title: 'dropped',
    })
    // Raw driver: Mongoose marks createdAt immutable, so a model update
    // would silently strip the backdating this fixture depends on.
    await DeckModel.collection.updateOne(
      { _id: outside._id },
      { $set: { createdAt: new Date(Date.now() + 7_200_000) } },
    )
    const to = new Date(Date.now() + 3_600_000).toISOString()
    const bundle = await getBundle(`?to=${encodeURIComponent(to)}`)
    expect(column(bundle.get('slides.csv')!, 'deckId')).toEqual([
      bundled._id.toString(),
    ])
    expect(column(bundle.get('lectures.csv')!, 'deckId')).toEqual([
      bundled._id.toString(),
    ])
  })

  it('rejects an unparseable date rather than ignoring it', async () => {
    const res = await getRaw('/api/admin/research/export?from=whenever')
    expect(res.status).toBe(400)
  })
})

describe('the gate', () => {
  it('refuses the export without admin', async () => {
    const anon = await request(server).get('/api/admin/research/export')
    expect([401, 403]).toContain(anon.status)

    const user = await makeUser()
    const token = await signAccessToken(user._id.toString())
    const nonAdmin = await request(server)
      .get('/api/admin/research/export')
      .set('Authorization', `Bearer ${token}`)
    expect(nonAdmin.status).toBe(403)
  })
})
