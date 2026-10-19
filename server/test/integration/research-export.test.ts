/**
 * Integration tests for the de-identified research export (SPEC EVAL-2):
 * the bundle's files and columns, the study-id pseudonymization (present,
 * consistent across files, stable across exports, and never accompanied by
 * a user id, email, or display name), window behavior including the
 * lecture-union rule, tombstone handling, and the admin gate.
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
import express from 'express'
import request from 'supertest'
import AdmZip from 'adm-zip'
import { Query, Types } from 'mongoose'
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
import { RefineJobModel } from '../../src/models/refine-job'
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
    RefineJobModel.deleteMany({}),
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
      'refine-jobs.csv',
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

  it('exports the channel a cost event arrived through', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // One request from the product's own front end, one from an external
    // assistant over MCP — the whole point is that an analyst can tell
    // them apart in the export, not just in the database.
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      channel: 'app',
      deckId: deck._id,
      deckName: deck.title,
      metric: 'sttMinutes',
      quantity: 1,
      billable: true,
      costMicros: 500_000,
      currency: 'USD',
      occurredAt: new Date(),
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      channel: 'agent',
      deckId: deck._id,
      deckName: deck.title,
      metric: 'sttMinutes',
      quantity: 1,
      billable: true,
      costMicros: 500_000,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    const csv = bundle.get('cost-events.csv')!
    // Pin the header itself, so a future column reorder can't silently
    // shift which value 'channel' reads out as.
    const [header] = csv.trim().split('\r\n')
    expect(header!.split(',')).toContain('channel')
    expect(column(csv, 'channel').sort()).toEqual(['agent', 'app'])
  })

  it("reads a row written before the column existed as 'app', as the README promises", async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // Written straight to the collection, bypassing the schema, so the
    // document genuinely has no `channel` path — which is what every row
    // recorded before BILL-7 added the field looks like. Creating one through
    // the model instead would apply the default on write and prove nothing.
    await CostEventModel.collection.insertOne({
      payerId: owner._id,
      actorKind: 'owner',
      deckId: deck._id,
      deckName: deck.title,
      metric: 'exports',
      quantity: 1,
      billable: true,
      costMicros: 1_000,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    // The README tells analysts a blank-looking channel means 'app'. The
    // export reads plain rows (EVAL-2), which carry no schema defaults, so it
    // restores 'app' itself — that is what keeps the README true.
    expect(column(bundle.get('cost-events.csv')!, 'channel')).toEqual(['app'])
    expect(bundle.get('README.md')).toContain("reads as 'app'")
  })

  it('exports which slide a piece of narration was for, blank for whole-lecture work', async () => {
    const owner = await makeUser()
    const listener = await makeUser({ email: 'listener@example.com' })
    const deck = await makeDeck(owner._id)
    const slide = await SlideModel.create({
      deckId: deck._id,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
    })
    // Narration is for one slide; translating the deck is whole-lecture work
    // with no one slide to name.
    await CostEventModel.create({
      payerId: owner._id,
      actorId: listener._id,
      actorKind: 'audience',
      deckId: deck._id,
      deckName: deck.title,
      slideId: slide._id,
      metric: 'audienceTtsCharacters',
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
      metric: 'translationCharacters',
      quantity: 40,
      billable: true,
      costMicros: 4_000,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    expect(column(bundle.get('cost-events.csv')!, 'slideId').sort()).toEqual([
      '',
      slide._id.toString(),
    ])
    expect(bundle.get('README.md')).toContain('slideId')
  })

  it('exports why a translation happened, and tells an analyst how to read it', async () => {
    const owner = await makeUser()
    const reader = await makeUser({ email: 'reader@example.com' })
    const deck = await makeDeck(owner._id)
    // A reading, a narration, and one row with no trigger at all — the three
    // shapes a real ledger has, and the three a reader of the CSV must be
    // able to tell apart.
    await CostEventModel.create({
      payerId: owner._id,
      actorId: reader._id,
      actorKind: 'audience',
      deckId: deck._id,
      deckName: deck.title,
      locale: 'zh',
      trigger: 'reading',
      metric: 'audienceLocales',
      quantity: 1,
      billable: true,
      costMicros: 0,
      currency: 'USD',
      occurredAt: new Date(),
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorId: reader._id,
      actorKind: 'audience',
      deckId: deck._id,
      deckName: deck.title,
      locale: 'zh',
      trigger: 'narration',
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
    expect(column(bundle.get('cost-events.csv')!, 'trigger').sort()).toEqual([
      '',
      'narration',
      'reading',
    ])
    expect(bundle.get('README.md')).toContain("filter to trigger = 'reading'")
  })

  it('tells analysts which metric carries whose reading', async () => {
    const owner = await makeUser()
    const student = await makeUser({ email: 'student@example.com' })
    const deck = await makeDeck(owner._id)
    // The same act — opening the lecture in French — recorded twice, once by
    // the instructor and once by a student, in the two different units BILL-3
    // bills them in. Both are readings; only one is on audienceLocales.
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      deckId: deck._id,
      metric: 'translationCharacters',
      locale: 'fr',
      trigger: 'reading',
      quantity: 120,
      billable: true,
      costMicros: 1_200,
      currency: 'USD',
      occurredAt: new Date(),
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorId: student._id,
      actorKind: 'audience',
      deckId: deck._id,
      metric: 'audienceLocales',
      locale: 'fr',
      trigger: 'reading',
      quantity: 1,
      billable: true,
      costMicros: 0,
      currency: 'USD',
      occurredAt: new Date(),
    })

    const bundle = await getBundle()
    const csv = bundle.get('cost-events.csv')!
    expect(column(csv, 'trigger').sort()).toEqual(['reading', 'reading'])

    // The README has to name both metrics. It used to send analysts to
    // audienceLocales alone, which would report this lecture as read once in
    // French when it was read twice — a plausible number, quietly missing
    // every reading the instructor did.
    const readme = bundle.get('README.md')!
    expect(readme).toContain('translationCharacters')
    expect(readme).toContain('audienceLocales')
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

  it('carries reading depth as a floor, blank when never reported', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // Depth reported: how far this reading got.
    await DeckViewModel.create({
      deckId: deck._id,
      deckName: deck.title,
      ownerId: owner._id,
      viewerId: null,
      actorKind: 'audience',
      channel: 'app',
      occurredAt: new Date(),
      slidesReached: 7,
      activeMs: 120_000,
    })
    // No depth report ever arrived — the tab closed before one landed.
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
    const csv = bundle.get('deck-views.csv')!
    expect(column(csv, 'slidesReached').sort()).toEqual(['', '7'])
    expect(column(csv, 'activeMs').sort()).toEqual(['', '120000'])
    expect(bundle.get('README.md')).toContain('slidesReached')
    expect(bundle.get('README.md')).toContain('activeMs')
    expect(bundle.get('README.md')).toContain('floor')
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

describe('refine jobs', () => {
  it('records what a run was asked to do alongside what it changed', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    await RefineJobModel.create({
      deckId: deck._id,
      status: 'done',
      // What was asked for — a single-key `parts` keeps the JSON cell
      // comma-free so this fixture can assert it with the same naive
      // column() splitter as the rest of this file.
      request: {
        identifySpeakers: true,
        slidesLevel: 3,
        slidesParts: { text: true },
        allowSplit: true,
        transcriptLevel: 2,
      },
      // What actually happened — deliberately different numbers, so a
      // test that only checked one side could not pass by accident.
      summary: {
        reframed: 1,
        slidesRefined: 2,
        slidesSplit: 1,
        transcriptsUpdated: 4,
      },
    })

    const bundle = await getBundle()
    const csv = bundle.get('refine-jobs.csv')!
    expect(column(csv, 'deckId')).toEqual([deck._id.toString()])
    expect(column(csv, 'status')).toEqual(['done'])
    expect(column(csv, 'identifySpeakers')).toEqual(['true'])
    expect(column(csv, 'slidesLevel')).toEqual(['3'])
    expect(column(csv, 'allowSplit')).toEqual(['true'])
    expect(column(csv, 'transcriptLevel')).toEqual(['2'])
    // The cell is CSV-quoted (it contains commas/quotes), so its embedded
    // quotes are doubled per RFC 4180 — hence the doubled quotes here too.
    expect(csv).toContain('""text"":true')
    expect(column(csv, 'reframed')).toEqual(['1'])
    expect(column(csv, 'slidesRefined')).toEqual(['2'])
    expect(column(csv, 'slidesSplit')).toEqual(['1'])
    expect(column(csv, 'transcriptsUpdated')).toEqual(['4'])
  })

  it('includes a failed run, with its error and status', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    await RefineJobModel.create({
      deckId: deck._id,
      status: 'error',
      request: { transcriptLevel: 1 },
      error: 'Deck no longer exists',
    })

    const bundle = await getBundle()
    const csv = bundle.get('refine-jobs.csv')!
    expect(column(csv, 'status')).toEqual(['error'])
    expect(column(csv, 'error')).toEqual(['Deck no longer exists'])
  })

  it('includes a soft-deleted run, marked by deletedAt', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    await RefineJobModel.create({
      deckId: deck._id,
      status: 'done',
      summary: {
        reframed: 0,
        slidesRefined: 0,
        slidesSplit: 0,
        transcriptsUpdated: 0,
      },
      deletedAt: new Date(),
    })

    const bundle = await getBundle()
    const deleted = column(bundle.get('refine-jobs.csv')!, 'deletedAt')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).not.toBe('')
  })

  it('unions in a lecture whose only in-window activity is a refine job', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    // The lecture predates the window; only the refine job falls inside. A
    // refine-only lecture must still find a row to join to.
    const future = new Date(Date.now() + 3_600_000)
    await RefineJobModel.create({
      deckId: deck._id,
      status: 'running',
    })
    await RefineJobModel.collection.updateOne(
      { deckId: deck._id },
      { $set: { createdAt: new Date(future.getTime() + 60_000) } },
    )

    const bundle = await getBundle(
      `?from=${encodeURIComponent(future.toISOString())}`,
    )
    expect(column(bundle.get('lectures.csv')!, 'deckId')).toEqual([
      deck._id.toString(),
    ])
    expect(column(bundle.get('refine-jobs.csv')!, 'deckId')).toEqual([
      deck._id.toString(),
    ])
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
/** Ids are written out in full so the expected CSV below is fixed text. */
const oid = (suffix: string): Types.ObjectId =>
  new Types.ObjectId(suffix.padStart(24, '0'))
const at = (time: string): Date => new Date(`2026-03-${time}Z`)

/** One expected CSV line: cells are already CSV-escaped, joined as written. */
const line = (...cells: (string | number)[]): string => cells.join(',')
const expectedCsv = (...lines: string[]): string =>
  lines.map(l => l + '\r\n').join('')

describe('the whole bundle, file by file (EVAL-2 equivalence)', () => {
  /**
   * Seeds every shape the export has to render the same way whether it reads
   * hydrated documents or plain rows: rows missing defaulted fields (so the
   * schema default is what the CSV shows), deleted and live rows, and
   * optional subdocuments present and absent. Written through the raw driver
   * so the missing fields are genuinely missing in the database.
   */
  const seed = async (): Promise<void> => {
    const [u1, u2, u3] = [oid('a01'), oid('a02'), oid('a03')]
    const project = oid('a1')
    await UserModel.collection.insertMany([
      {
        _id: u1,
        email: 'o@example.com',
        displayName: 'O',
        studyId: 'aaaaaaaaaaaaaaaa',
      },
      {
        _id: u2,
        email: 'v@example.com',
        displayName: 'V',
        studyId: 'bbbbbbbbbbbbbbbb',
      },
      {
        _id: u3,
        email: 'w@example.com',
        displayName: 'W',
        studyId: 'cccccccccccccccc',
      },
    ])
    await DeckModel.collection.insertMany([
      {
        _id: oid('d1'),
        projectId: project,
        ownerId: u1,
        title: 'Osmosis',
        studyLabel: 'cond-A',
        language: 'en',
        templateId: 'classic',
        permalinkSlug: 'slug-d1',
        slideOrder: ['s1', 's2'],
        voteScore: 3,
        quiz: { formId: 'form-1', publishedAt: at('02T00:00:00.000') },
        createdAt: at('01T10:00:00.000'),
        updatedAt: at('01T12:00:00.000'),
        deletedAt: null,
      },
      {
        // Missing title, slideOrder, voteScore, updatedAt, deletedAt, quiz.
        _id: oid('d2'),
        projectId: project,
        ownerId: u1,
        templateId: 'classic',
        permalinkSlug: 'slug-d2',
        createdAt: at('01T11:00:00.000'),
      },
      {
        _id: oid('d3'),
        projectId: project,
        ownerId: u1,
        title: 'Gone',
        templateId: 'classic',
        permalinkSlug: 'slug-d3',
        slideOrder: ['x'],
        voteScore: -1,
        createdAt: at('01T12:00:00.000'),
        updatedAt: at('04T00:00:00.000'),
        deletedAt: at('05T00:00:00.000'),
      },
    ])
    await SlideModel.collection.insertMany([
      {
        _id: oid('51'),
        deckId: oid('d1'),
        index: 0,
        layoutType: 'content',
        title: 'Cells',
        body: 'Body text',
        bullets: ['a', 'b'],
        caption: 'cap',
        imageSource: 'stock',
        slots: { t: 'x' },
        manuallyEdited: true,
        sourceTranscript: 'said, this',
      },
      {
        _id: oid('52'),
        deckId: oid('d1'),
        index: 1,
        layoutType: 'content',
        title: 'Second',
        deletedAt: at('06T00:00:00.000'),
      },
      { _id: oid('53'), deckId: oid('d3'), index: 0, layoutType: 'title' },
    ])
    await TranscriptSegmentModel.collection.insertMany([
      {
        _id: oid('61'),
        deckId: oid('d1'),
        sessionId: 'sess-1',
        slideId: oid('51'),
        startMs: 0,
        endMs: 900,
        text: 'hello there',
        confidence: 0.9,
        words: [
          { word: 'hello', startMs: 0, endMs: 400 },
          { word: 'there', startMs: 400, endMs: 900 },
        ],
        action: 'new',
        speaker: 0,
        role: 'lecturer',
        createdAt: at('01T10:05:00.000'),
      },
      {
        // Empty words array, and no action (the schema default is 'none').
        _id: oid('62'),
        deckId: oid('d1'),
        sessionId: 'sess-1',
        startMs: 1000,
        endMs: 1500,
        text: 'empty words',
        words: [],
        createdAt: at('01T10:06:00.000'),
      },
      {
        // No words at all, deleted.
        _id: oid('63'),
        deckId: oid('d3'),
        text: 'with, comma',
        action: 'update',
        speaker: 1,
        role: 'student',
        createdAt: at('01T10:07:00.000'),
        deletedAt: at('08T00:00:00.000'),
      },
    ])
    await VoteModel.collection.insertMany([
      {
        // No createdAt: the export falls back to the id's own timestamp.
        _id: new Types.ObjectId('65f000000000000000000001'),
        userId: u3,
        targetType: 'template',
        targetId: 'tpl-1',
        value: -1,
      },
      {
        _id: oid('b2'),
        userId: u2,
        targetType: 'deck',
        targetId: oid('d1'),
        value: 1,
        createdAt: at('01T13:00:00.000'),
      },
    ])
    await CostEventModel.collection.insertMany([
      {
        _id: oid('c1'),
        payerId: u1,
        actorId: u2,
        actorKind: 'audience',
        channel: 'agent',
        projectId: project,
        projectName: 'Biology',
        deckId: oid('d1'),
        deckName: 'Osmosis',
        slideId: oid('51'),
        locale: 'zh',
        trigger: 'reading',
        metric: 'audienceTtsCharacters',
        quantity: 12,
        billable: false,
        costMicros: 1_500_000,
        currency: 'USD',
        occurredAt: at('01T14:00:00.000'),
      },
      {
        // No actor, slide, deck, channel, billable or costMicros: the schema
        // defaults ('app', true, 0) are what the CSV shows.
        _id: oid('c2'),
        payerId: u1,
        actorKind: 'system',
        metric: 'sttMinutes',
        quantity: 3,
        currency: 'USD',
        occurredAt: at('01T15:00:00.000'),
      },
    ])
    await RefineJobModel.collection.insertMany([
      {
        _id: oid('71'),
        deckId: oid('d1'),
        status: 'done',
        request: {
          identifySpeakers: true,
          slidesLevel: 3,
          slidesParts: { text: true },
          allowSplit: false,
          transcriptLevel: 2,
        },
        summary: {
          reframed: 4,
          slidesRefined: 3,
          slidesSplit: 2,
          transcriptsUpdated: 1,
        },
        createdAt: at('01T16:00:00.000'),
        updatedAt: at('01T16:30:00.000'),
      },
      {
        // No status (default 'running'), request, summary or updatedAt.
        _id: oid('72'),
        deckId: oid('d3'),
        error: 'boom',
        createdAt: at('01T17:00:00.000'),
        deletedAt: at('07T00:00:00.000'),
      },
      {
        // A request with only one field set.
        _id: oid('73'),
        deckId: oid('d1'),
        status: 'error',
        request: { transcriptLevel: 1 },
        createdAt: at('01T18:00:00.000'),
        updatedAt: at('01T18:00:00.000'),
      },
    ])
    await DeckViewModel.collection.insertMany([
      {
        _id: oid('e1'),
        deckId: oid('d1'),
        deckName: 'Osmosis',
        projectId: project,
        projectName: 'Biology',
        ownerId: u1,
        viewerId: u3,
        actorKind: 'audience',
        channel: 'agent',
        occurredAt: at('01T19:00:00.000'),
        slidesReached: 0,
        activeMs: 120_000,
      },
      {
        // No viewer, channel, or depth.
        _id: oid('e2'),
        deckId: oid('d1'),
        ownerId: u1,
        actorKind: 'audience',
        occurredAt: at('01T20:00:00.000'),
      },
    ])
  }

  const D = (n: string) => oid(n).toString()
  const OWNER = 'aaaaaaaaaaaaaaaa'
  const VOTER = 'bbbbbbbbbbbbbbbb'
  const VIEWER = 'cccccccccccccccc'

  // Expected text, written by hand from the seed above.
  const EXPECTED: Record<string, string> = {
    'lectures.csv': expectedCsv(
      'deckId,projectId,ownerStudyId,title,studyLabel,language,templateId,slideCount,voteScore,quizFormId,quizPublishedAt,createdAt,updatedAt,deletedAt',
      line(
        D('d1'),
        D('a1'),
        OWNER,
        'Osmosis',
        'cond-A',
        'en',
        'classic',
        2,
        3,
        'form-1',
        '2026-03-02T00:00:00.000Z',
        '2026-03-01T10:00:00.000Z',
        '2026-03-01T12:00:00.000Z',
        '',
      ),
      line(
        D('d2'),
        D('a1'),
        OWNER,
        '',
        '',
        '',
        'classic',
        0,
        0,
        '',
        '',
        '2026-03-01T11:00:00.000Z',
        '2026-03-01T11:00:00.000Z',
        '',
      ),
      line(
        D('d3'),
        D('a1'),
        OWNER,
        'Gone',
        '',
        '',
        'classic',
        1,
        "'-1",
        '',
        '',
        '2026-03-01T12:00:00.000Z',
        '2026-03-04T00:00:00.000Z',
        '2026-03-05T00:00:00.000Z',
      ),
    ),
    'slides.csv': expectedCsv(
      'slideId,deckId,index,layoutType,title,body,bullets,caption,imageSource,slots,manuallyEdited,sourceTranscript,deletedAt',
      line(
        D('51'),
        D('d1'),
        0,
        'content',
        'Cells',
        'Body text',
        '"[""a"",""b""]"',
        'cap',
        'stock',
        '"{""t"":""x""}"',
        'true',
        '"said, this"',
        '',
      ),
      line(
        D('52'),
        D('d1'),
        1,
        'content',
        'Second',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '2026-03-06T00:00:00.000Z',
      ),
      line(D('53'), D('d3'), 0, 'title', '', '', '', '', '', '', '', '', ''),
    ),
    'transcript-segments.csv': expectedCsv(
      'segmentId,deckId,sessionId,slideId,startMs,endMs,text,confidence,wordCount,action,speaker,role,createdAt,deletedAt',
      line(
        D('61'),
        D('d1'),
        'sess-1',
        D('51'),
        0,
        900,
        'hello there',
        0.9,
        2,
        'new',
        0,
        'lecturer',
        '2026-03-01T10:05:00.000Z',
        '',
      ),
      line(
        D('62'),
        D('d1'),
        'sess-1',
        '',
        1000,
        1500,
        'empty words',
        '',
        0,
        'none',
        '',
        '',
        '2026-03-01T10:06:00.000Z',
        '',
      ),
      line(
        D('63'),
        D('d3'),
        '',
        '',
        '',
        '',
        '"with, comma"',
        '',
        '',
        'update',
        1,
        'student',
        '2026-03-01T10:07:00.000Z',
        '2026-03-08T00:00:00.000Z',
      ),
    ),
    'votes.csv': expectedCsv(
      'voterStudyId,targetType,targetId,value,createdAt',
      line(VIEWER, 'template', 'tpl-1', "'-1", '2024-03-12T07:10:56.000Z'),
      line(VOTER, 'deck', D('d1'), 1, '2026-03-01T13:00:00.000Z'),
    ),
    'cost-events.csv': expectedCsv(
      'occurredAt,payerStudyId,actorStudyId,actorKind,channel,projectId,projectName,deckId,deckName,slideId,locale,trigger,metric,quantity,billable,cost,currency',
      line(
        '2026-03-01T14:00:00.000Z',
        OWNER,
        VOTER,
        'audience',
        'agent',
        D('a1'),
        'Biology',
        D('d1'),
        'Osmosis',
        D('51'),
        'zh',
        'reading',
        'audienceTtsCharacters',
        12,
        'false',
        '1.500000',
        'USD',
      ),
      line(
        '2026-03-01T15:00:00.000Z',
        OWNER,
        '',
        'system',
        'app',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'sttMinutes',
        3,
        'true',
        '0.000000',
        'USD',
      ),
    ),
    'refine-jobs.csv': expectedCsv(
      'jobId,deckId,status,identifySpeakers,slidesLevel,slidesParts,transcriptLevel,allowSplit,reframed,slidesRefined,slidesSplit,transcriptsUpdated,error,createdAt,updatedAt,deletedAt',
      line(
        D('71'),
        D('d1'),
        'done',
        'true',
        3,
        '"{""text"":true}"',
        2,
        'false',
        4,
        3,
        2,
        1,
        '',
        '2026-03-01T16:00:00.000Z',
        '2026-03-01T16:30:00.000Z',
        '',
      ),
      line(
        D('72'),
        D('d3'),
        'running',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'boom',
        '2026-03-01T17:00:00.000Z',
        '2026-03-01T17:00:00.000Z',
        '2026-03-07T00:00:00.000Z',
      ),
      line(
        D('73'),
        D('d1'),
        'error',
        '',
        '',
        // A run with a request but no slidesParts renders `{}`, not blank:
        // the hydrated request supplies an empty nested object.
        '{}',
        1,
        '',
        '',
        '',
        '',
        '',
        '',
        '2026-03-01T18:00:00.000Z',
        '2026-03-01T18:00:00.000Z',
        '',
      ),
    ),
    'deck-views.csv': expectedCsv(
      'occurredAt,deckId,deckName,projectId,projectName,ownerStudyId,viewerStudyId,actorKind,channel,slidesReached,activeMs',
      line(
        '2026-03-01T19:00:00.000Z',
        D('d1'),
        'Osmosis',
        D('a1'),
        'Biology',
        OWNER,
        VIEWER,
        'audience',
        'agent',
        0,
        120000,
      ),
      line(
        '2026-03-01T20:00:00.000Z',
        D('d1'),
        '',
        '',
        '',
        OWNER,
        '',
        'audience',
        'app',
        '',
        '',
      ),
    ),
  }

  it('writes every CSV exactly as before, including rows missing defaulted fields', async () => {
    await seed()
    const bundle = await getBundle()
    for (const [name, expected] of Object.entries(EXPECTED)) {
      expect(bundle.get(name), name).toBe(expected)
    }
    // No telemetry was seeded: the file is its header and nothing else.
    expect(bundle.get('session-telemetry.csv')!.split('\r\n')).toHaveLength(2)
  })

  it('pseudonymizes every account any dataset references', async () => {
    await seed()
    await UserModel.collection.updateMany({}, { $unset: { studyId: '' } })
    await getBundle()
    const keyed = await UserModel.find({
      _id: { $in: [oid('a01'), oid('a02'), oid('a03')] },
    }).select('_id +studyId')
    expect(keyed).toHaveLength(3)
    for (const user of keyed) expect(user.studyId).toMatch(/^[0-9a-f]{16}$/)
  })
})
describe('the bundle reads lean and narrow (EVAL-2 memory)', () => {
  it('reads every dataset as plain rows, and never loads transcript words', async () => {
    const owner = await makeUser()
    const deck = await makeDeck(owner._id)
    await TranscriptSegmentModel.create({
      deckId: deck._id,
      text: 'a long phrase',
      words: [{ word: 'a', startMs: 0, endMs: 1 }],
    })
    await VoteModel.create({
      userId: owner._id,
      targetType: 'deck',
      targetId: deck._id,
      value: 1,
    })
    await CostEventModel.create({
      payerId: owner._id,
      actorKind: 'owner',
      metric: 'sttMinutes',
      quantity: 1,
      costMicros: 1,
      currency: 'USD',
    })
    await RefineJobModel.create({ deckId: deck._id })
    await DeckViewModel.create({
      deckId: deck._id,
      ownerId: owner._id,
      actorKind: 'owner',
    })
    await SlideModel.create({
      deckId: deck._id,
      index: 0,
      layoutType: 'title',
    })

    // Record how each read is issued, without changing what it does.
    type Seen = { model: string; lean: boolean; fields: unknown }
    const reads: Seen[] = []
    const realExec = Query.prototype.exec
    const spy = vi.spyOn(Query.prototype, 'exec').mockImplementation(function (
      this: Query<unknown, unknown>,
    ) {
      // Mongoose keeps these on the query but does not type them.
      const query = this as unknown as {
        op: string
        model: { modelName: string }
        _mongooseOptions: { lean?: unknown }
        projection: () => unknown
      }
      if (query.op === 'find') {
        reads.push({
          model: query.model.modelName,
          lean: Boolean(query._mongooseOptions.lean),
          fields: query.projection(),
        })
      }
      return realExec.apply(this)
    } as typeof Query.prototype.exec)
    try {
      await getBundle()
    } finally {
      spy.mockRestore()
    }

    const models = [
      'Deck',
      'Slide',
      'TranscriptSegment',
      'Vote',
      'CostEvent',
      'RefineJob',
      'DeckView',
    ]
    for (const model of models) {
      const mine = reads.filter(r => r.model === model)
      expect(mine.length, `${model} was read`).toBeGreaterThan(0)
      // Plain rows, narrowed to the columns the CSV writes.
      for (const read of mine) {
        expect(read.lean, `${model} read lean`).toBe(true)
        expect(read.fields, `${model} read with a projection`).toBeTruthy()
      }
    }
    // The word list is the bulk of a segment; only its length may be asked for.
    const segmentRead = reads.find(r => r.model === 'TranscriptSegment')!
    expect(Object.keys(segmentRead.fields as object)).not.toContain('words')
  })
})
