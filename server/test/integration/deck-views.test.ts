/**
 * Integration tests for counting lecture openings (SPEC EVAL-7):
 * POST /api/decks/:slug/view.
 *
 * The point of the endpoint is that it is *not* a count of `GET /decks/:slug`
 * — the viewer re-fetches the same deck to poll for retained audio and after a
 * settings change, and neither is a reading. So these assert on what the route
 * records for each kind of reader, and that nothing about reading a lecture
 * touches an allowance.
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
import { DeckViewModel } from '../../src/models/deck-view'
import { CostEventModel } from '../../src/models/cost-event'
import { UsageRecordModel } from '../../src/models/usage-record'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { purgeExpiredDeckViews } from '../../src/jobs/deck-view-purge'
import { resetDeckViewRateLimit } from '../../src/routes/decks'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) throw new Error(`registration failed: ${res.status}`)
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Open the lecture, signed in or not. */
const open = (target = slug, token?: string) => {
  const req = request(server).post(`/api/decks/${target}/view`)
  if (token) req.set('Authorization', `Bearer ${token}`)
  return req.send()
}

const views = async () => DeckViewModel.find({}).sort({ _id: 1 }).lean()

let ada: string
let adaId: string
let byron: string
let byronId: string
let projectId: string
let deckId: string
let slug: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init(), DeckViewModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  // The nuisance guard on the beacon counts per process, so one case's
  // openings would otherwise be charged against the next one's budget.
  resetDeckViewRateLimit()
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    DeckViewModel.deleteMany({}),
    CostEventModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  byron = await registerUser('byron@example.com')
  byronId = (await UserModel.findOne({
    email: 'byron@example.com',
  }))!._id.toString()

  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
})

describe('recording that a lecture was opened', () => {
  it('records a signed-in reader as audience, by name', async () => {
    expect((await open(slug, byron)).status).toBe(204)

    const [row] = await views()
    expect(row).toBeDefined()
    expect(row!.viewerId?.toString()).toBe(byronId)
    expect(row!.actorKind).toBe('audience')
    expect(row!.deckId.toString()).toBe(deckId)
    expect(row!.ownerId.toString()).toBe(adaId)
    // Denormalized, because the row outlives the lecture it describes.
    expect(row!.deckName).toBe('Waves')
    expect(row!.projectName).toBe('Physics')
    expect(row!.channel).toBe('app')
  })

  it('counts a signed-out reader without identifying them', async () => {
    expect((await open()).status).toBe(204)

    const [row] = await views()
    // The whole compromise §16 requires: the opening is recorded, the person
    // is not. Nothing — no cookie, no token — stands in for the missing id.
    expect(row!.viewerId).toBeNull()
    expect(row!.actorKind).toBe('audience')
    expect(row!.deckId.toString()).toBe(deckId)
  })

  it('separates the lecture owner from its audience', async () => {
    await open(slug, ada)
    await open(slug, byron)
    await open()

    expect((await views()).map(v => v.actorKind)).toEqual([
      'owner',
      'audience',
      'audience',
    ])
  })

  it('counts every opening, including a re-read', async () => {
    // One row per opening is the stated shape: a reader who comes back
    // tomorrow read it twice, and collapsing that would lose the signal the
    // count exists to carry.
    await open(slug, byron)
    await open(slug, byron)
    await open()

    const rows = await views()
    expect(rows).toHaveLength(3)
    expect(rows.filter(v => v.viewerId).length).toBe(2)
    expect(rows.filter(v => !v.viewerId).length).toBe(1)
  })

  it('answers the question it exists for', async () => {
    await open(slug, byron)
    await open(slug, byron)
    await open()
    await open()
    await open(slug, ada)

    const audience = (await views()).filter(v => v.actorKind === 'audience')
    expect(audience).toHaveLength(4)
    // Signed-in readers can be counted as people; signed-out ones only as
    // openings — and the export says so rather than implying otherwise.
    expect(
      new Set(audience.filter(v => v.viewerId).map(v => String(v.viewerId)))
        .size,
    ).toBe(1)
    expect(audience.filter(v => !v.viewerId)).toHaveLength(2)
  })
})

describe('reading a lecture is free', () => {
  it('spends no allowance and writes no cost event', async () => {
    await open(slug, byron)
    await open()
    await open(slug, ada)

    // Anchor the two absences below to work that actually happened. Both
    // counters are zero after the setup alone, so on their own they cannot
    // tell "reading is free" apart from "the route wrote nothing at all".
    expect(await DeckViewModel.countDocuments({})).toBe(3)
    // Opening a lecture is not metered work. If this ever fails, a view has
    // been given a price, and a cap could then refuse to open a lecture.
    expect(await CostEventModel.countDocuments({})).toBe(0)
    expect(await UsageRecordModel.countDocuments({})).toBe(0)
  })
})

describe('access', () => {
  it('refuses a lecture the reader cannot view', async () => {
    // A lecture's visibility is its project's, so this is where it is set.
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    const res = await open()
    expect([401, 403, 404]).toContain(res.status)
    expect(await DeckViewModel.countDocuments({})).toBe(0)
  })

  it('refuses a lecture that does not exist', async () => {
    const res = await open('no-such-lecture')
    expect(res.status).toBe(404)
    expect(await DeckViewModel.countDocuments({})).toBe(0)
  })
})

describe('retention', () => {
  /** One opening, at a chosen moment. */
  const viewAt = (occurredAt: Date) =>
    DeckViewModel.create({
      deckId,
      deckName: 'Waves',
      ownerId: adaId,
      viewerId: null,
      actorKind: 'audience',
      channel: 'app',
      occurredAt,
    })

  const DAY = 24 * 60 * 60 * 1000

  it('drops openings past the window and keeps the rest', async () => {
    const now = new Date('2026-06-01T00:00:00Z')
    await viewAt(new Date(now.getTime() - 400 * DAY))
    await viewAt(new Date(now.getTime() - 10 * DAY))

    expect(await purgeExpiredDeckViews(365, now)).toEqual({ deleted: 1 })
    const left = await views()
    expect(left).toHaveLength(1)
    expect(left[0]!.occurredAt.getTime()).toBe(now.getTime() - 10 * DAY)
  })

  it('keeps everything when retention is switched off', async () => {
    const now = new Date('2026-06-01T00:00:00Z')
    await viewAt(new Date(now.getTime() - 4000 * DAY))

    // Zero means "keep forever". A cutoff of `now` would read the same
    // switch as "delete the lot", which is the opposite instruction.
    expect(await purgeExpiredDeckViews(0, now)).toEqual({ deleted: 0 })
    expect(await views()).toHaveLength(1)
  })
})

describe('the nuisance guard on an endpoint anyone can post to', () => {
  // The endpoint takes no credentials and writes a row that survives a year,
  // so a loop against a public permalink would both skew the count and grow
  // the collection. The guard bounds that without the reader ever seeing it.
  it('stops recording once a caller floods the endpoint, still answering 204', async () => {
    for (let i = 0; i < 120; i += 1) {
      const res = await open()
      expect(res.status).toBe(204)
    }
    expect(await DeckViewModel.countDocuments({})).toBe(120)

    // Over the line: still 204, but no longer recorded. A reader is never
    // refused their lecture to protect a statistic.
    const over = await open()
    expect(over.status).toBe(204)
    expect(await DeckViewModel.countDocuments({})).toBe(120)
  })

  it('counts again once the window is reset', async () => {
    for (let i = 0; i < 121; i += 1) await open()
    expect(await DeckViewModel.countDocuments({})).toBe(120)

    resetDeckViewRateLimit()
    await open()
    expect(await DeckViewModel.countDocuments({})).toBe(121)
  })

  // The guard must not be usable as a remote off-switch. Charging the budget
  // before the lecture resolved let a stranger spend it on slugs that name
  // nothing, and the next genuine opening of a real lecture went uncounted —
  // silently, and for the rest of the window.
  it('does not let unknown lectures spend the budget', async () => {
    for (let i = 0; i < 130; i += 1) {
      expect((await open('no-such-lecture')).status).toBe(404)
    }
    expect(await DeckViewModel.countDocuments({})).toBe(0)

    // The real lecture still counts, which is the whole point.
    expect((await open()).status).toBe(204)
    expect(await DeckViewModel.countDocuments({})).toBe(1)
  })

  // Same reasoning for a lecture the caller may not see: it never becomes a
  // row, so it must never cost a reader who may.
  it('does not let unviewable lectures spend the budget', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    for (let i = 0; i < 130; i += 1) {
      expect((await open(slug, byron)).status).toBe(404)
    }

    resetDeckViewRateLimit()
    await act(ada, 'deck.setAccess', { deckId, visibility: 'public' })
    expect((await open(slug, byron)).status).toBe(204)
    expect(await DeckViewModel.countDocuments({})).toBe(1)
  })
})
