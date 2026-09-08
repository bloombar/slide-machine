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
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
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

/** Report reading depth for an opening already recorded by `open()`. */
const complete = (
  body: {
    completionKey?: unknown
    slidesReached?: unknown
    activeMs?: unknown
  },
  target = slug,
) => request(server).post(`/api/decks/${target}/view/complete`).send(body)

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
    const res = await open(slug, byron)
    expect(res.status).toBe(200)
    // The single-use depth-reporting credential (EVAL-7 depth): ≥32 bytes
    // hex, so it is 64 or more hex characters.
    expect(res.body.completionKey).toMatch(/^[0-9a-f]{64,}$/)

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
    const res = await open()
    expect(res.status).toBe(200)
    expect(res.body.completionKey).toMatch(/^[0-9a-f]{64,}$/)

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
  const FLOOD = env.DECK_VIEW_RATE_LIMIT

  // The endpoint takes no credentials and writes a row that survives a year,
  // so a loop against a public permalink would both skew the count and grow
  // the collection. The guard bounds that without the reader ever seeing it.
  it('stops recording once a caller floods the endpoint, still answering 204', async () => {
    for (let i = 0; i < FLOOD; i += 1) await open()
    expect(await DeckViewModel.countDocuments({})).toBe(FLOOD)

    // Over the line: still 204, but no longer recorded. A reader is never
    // refused their lecture to protect a statistic.
    const over = await open()
    expect(over.status).toBe(204)
    expect(await DeckViewModel.countDocuments({})).toBe(FLOOD)
  })

  it('counts again once the window is reset', async () => {
    for (let i = 0; i < FLOOD + 1; i += 1) await open()
    expect(await DeckViewModel.countDocuments({})).toBe(FLOOD)

    resetDeckViewRateLimit()
    await open()
    expect(await DeckViewModel.countDocuments({})).toBe(FLOOD + 1)
  })

  // A dropped row is missing research data. The reader is not told, so the
  // operator has to be — and told which lecture, since that is what is short.
  it('warns once, naming the lecture and never the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (let i = 0; i < FLOOD + 3; i += 1) await open()

      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain(slug)
      // Never the address: this route takes care not to name a reader (§16),
      // and a log line would undo that for the anonymous ones.
      expect(line).not.toMatch(/\d+\.\d+\.\d+\.\d+|::ffff:|::1/)
    } finally {
      warn.mockRestore()
    }
  })

  // The guard must not be usable as a remote off-switch. Charging the budget
  // before the lecture resolved let a stranger spend it on slugs that name
  // nothing, and the next genuine opening of a real lecture went uncounted.
  it('does not let unknown lectures spend the budget', async () => {
    for (let i = 0; i < FLOOD + 10; i += 1) await open('no-such-lecture')
    expect(await DeckViewModel.countDocuments({})).toBe(0)

    // The real lecture still counts, which is the whole point.
    expect((await open()).status).toBe(200)
    expect(await DeckViewModel.countDocuments({})).toBe(1)
  })

  // Same reasoning for a lecture the caller may not see: it never becomes a
  // row, so it must never cost the readers who may see it. No reset here —
  // resetting between the flood and the assertion would clear the very budget
  // the test claims was never spent, and the test would pass either way.
  it('does not let unviewable lectures spend the budget', async () => {
    const other = await act(byron, 'project.create', { title: 'Byron' })
    const mine = await act(byron, 'deck.create', {
      projectId: other.body.id,
      title: 'Private',
    })
    await act(byron, 'deck.setAccess', {
      deckId: mine.body.id,
      visibility: 'restricted',
    })
    const hidden = (await DeckModel.findById(mine.body.id))!.permalinkSlug

    for (let i = 0; i < FLOOD + 10; i += 1) {
      expect((await open(hidden, ada)).status).toBe(404)
    }

    // Ada's budget is untouched, so her openings of a lecture she can see
    // are still recorded.
    expect((await open(slug, ada)).status).toBe(200)
    expect(await DeckViewModel.countDocuments({})).toBe(1)
  })

  // A shared address must not make readers share a budget: a lecture hall
  // behind one NAT is the case this guard most needs not to break.
  it('gives each signed-in reader their own budget', async () => {
    for (let i = 0; i < FLOOD + 1; i += 1) await open(slug, ada)
    const afterAda = await DeckViewModel.countDocuments({})
    expect(afterAda).toBe(FLOOD)

    // Same address, different account — and still counted.
    expect((await open(slug, byron)).status).toBe(200)
    expect(await DeckViewModel.countDocuments({})).toBe(afterAda + 1)
  })
})

/** Backs `slug`'s deck with some slides, so `slidesReached` has a range to
 * be validated against — a fresh `deck.create` starts with none. */
const addSlides = (count: number) =>
  SlideModel.create(
    Array.from({ length: count }, (_, index) => ({
      deckId,
      index,
      layoutType: 'content',
    })),
  )

describe('reporting how far a reader got (EVAL-7 depth)', () => {
  it('updates the opening the key names', async () => {
    await addSlides(5)
    const key = (await open()).body.completionKey as string

    const res = await complete({
      completionKey: key,
      slidesReached: 3,
      activeMs: 45_000,
    })
    expect(res.status).toBe(204)

    const [row] = await views()
    expect(row!.slidesReached).toBe(3)
    expect(row!.activeMs).toBe(45_000)
  })

  /**
   * The property the whole design rests on, and the one a single-use key
   * quietly destroys: a reading sends several reports and the *last* is the
   * accurate one.
   *
   * The client reports on a 30-second timer as well as on tab-close, so for
   * any reading longer than half a minute the first report to arrive is the
   * timer's, describing the first 30 seconds. If that first report retired
   * the key, every row in the study would hold "how far they got in 30
   * seconds" — a plausible-looking number that measures the timer instead of
   * the reading, and one no fixture-seeded test would ever contradict. So
   * these go through the real route more than once, the way a real reading
   * does, rather than writing the later state into the database by hand.
   */
  it('lets a later report raise what an earlier one recorded', async () => {
    await addSlides(5)
    const key = (await open()).body.completionKey as string

    // The 30-second flush, thirty seconds into a reading that has much
    // further to go.
    await complete({ completionKey: key, slidesReached: 2, activeMs: 30_000 })
    // The same reading, finished: the reader reached every slide and stayed
    // for four minutes. This is the report that must win.
    const last = await complete({
      completionKey: key,
      slidesReached: 5,
      activeMs: 240_000,
    })
    expect(last.status).toBe(204)

    const [row] = await views()
    expect(row!.slidesReached).toBe(5)
    expect(row!.activeMs).toBe(240_000)
  })

  it('keeps the key usable across every report one reading sends', async () => {
    await addSlides(10)
    const key = (await open()).body.completionKey as string

    // Eight flushes and a final unload — more than a single-use key would
    // survive, and each one must land.
    for (let slidesReached = 1; slidesReached <= 9; slidesReached += 1) {
      const res = await complete({
        completionKey: key,
        slidesReached,
        activeMs: slidesReached * 30_000,
      })
      expect(res.status).toBe(204)
    }

    const [row] = await views()
    expect(row!.slidesReached).toBe(9)
    expect(row!.activeMs).toBe(270_000)
    // Still live: nothing about reporting depth retires the key, because
    // there is no way for the server to know which report is the last one.
    expect(row!.completionKey).toBe(key)
  })

  it('never lets a report shrink an already-larger stored value', async () => {
    await addSlides(12)
    const key = (await open()).body.completionKey as string

    // A finished reading, then a straggler: the beacon that fired at slide 3
    // arriving after the one that fired at slide 10 (a retried `sendBeacon`,
    // or two reports racing on the wire). Reached entirely through the real
    // route — with a reusable key there is nothing left to simulate by hand.
    await complete({ completionKey: key, slidesReached: 10, activeMs: 500_000 })
    await complete({ completionKey: key, slidesReached: 3, activeMs: 1_000 })

    let [row] = await views()
    expect(row!.slidesReached).toBe(10)
    expect(row!.activeMs).toBe(500_000)

    // The straggler must have been *ignored*, not merely unable to land. A
    // route that retired the key on first use would hold 10 here too, for
    // entirely the wrong reason — so read on and prove the key still works.
    await complete({ completionKey: key, slidesReached: 12, activeMs: 600_000 })
    ;[row] = await views()
    expect(row!.slidesReached).toBe(12)
    expect(row!.activeMs).toBe(600_000)
  })

  it('takes each number on its own merits when one grew and the other did not', async () => {
    await addSlides(6)
    const key = (await open()).body.completionKey as string

    // A reader who read on without the clock moving (the tab was hidden for
    // the gap), then sat on the last slide without advancing. Neither report
    // is a superset of the other, and the row must end up holding the larger
    // of each.
    await complete({ completionKey: key, slidesReached: 2, activeMs: 90_000 })
    await complete({ completionKey: key, slidesReached: 6, activeMs: 90_000 })
    await complete({ completionKey: key, slidesReached: 6, activeMs: 150_000 })

    const [row] = await views()
    expect(row!.slidesReached).toBe(6)
    expect(row!.activeMs).toBe(150_000)
  })

  it('stops accepting a key once no honest reading could still be running', async () => {
    await addSlides(5)
    const key = (await open()).body.completionKey as string
    // The key is bounded by time rather than by use (decision 7). Age it past
    // its expiry rather than waiting a day for one.
    await DeckViewModel.updateOne(
      { completionKey: key },
      { $set: { completionKeyExpiresAt: new Date(Date.now() - 1000) } },
    )

    const res = await complete({
      completionKey: key,
      slidesReached: 5,
      activeMs: 60_000,
    })
    expect(res.status).toBe(204)

    const [row] = await views()
    expect(row!.slidesReached).toBeNull()
    expect(row!.activeMs).toBeNull()
  })

  it('issues a key that expires, rather than one good forever', async () => {
    await addSlides(2)
    const before = Date.now()
    const key = (await open()).body.completionKey as string

    const after = Date.now()

    const [row] = await views()
    expect(row!.completionKey).toBe(key)
    // A live key with no expiry would be a permanent capability on the row;
    // the window is a reading's length, not the row's lifetime. The key was
    // issued at some instant between `before` and `after`, so its expiry must
    // land in that same span shifted forward by exactly one TTL — which pins
    // the TTL without pinning the clock.
    expect(row!.completionKeyExpiresAt).toBeInstanceOf(Date)
    const expiresAt = row!.completionKeyExpiresAt!.getTime()
    const TTL_MS = 24 * 60 * 60 * 1000
    expect(expiresAt).toBeGreaterThanOrEqual(before + TTL_MS)
    expect(expiresAt).toBeLessThanOrEqual(after + TTL_MS)
  })

  it('rejects out-of-range or malformed values without a 500, and records nothing', async () => {
    await addSlides(3)
    const key = (await open()).body.completionKey as string
    const bad = [
      { completionKey: key, slidesReached: -1, activeMs: 1000 }, // negative
      { completionKey: key, slidesReached: 1.5, activeMs: 1000 }, // non-integer
      { completionKey: key, slidesReached: 999, activeMs: 1000 }, // beyond the deck's slide count
      { completionKey: key, slidesReached: 1, activeMs: -5 }, // negative time
      { completionKey: key, slidesReached: 1, activeMs: 999_999_999_999 }, // past the sane ceiling
      { completionKey: 12345, slidesReached: 1, activeMs: 1000 }, // key not a string
      {}, // nothing at all
    ]
    for (const body of bad) {
      const res = await complete(body)
      expect(res.status).toBe(204)
    }

    // None of the above touched the row — the key is still there, waiting
    // for a legitimate report.
    const [row] = await views()
    expect(row!.slidesReached).toBeNull()
    expect(row!.activeMs).toBeNull()
    expect(row!.completionKey).toBe(key)
  })

  it("carries a signed-out reader's depth without identifying them", async () => {
    await addSlides(4)
    const key = (await open()).body.completionKey as string
    await complete({ completionKey: key, slidesReached: 4, activeMs: 60_000 })

    const [row] = await views()
    expect(row!.viewerId).toBeNull()
    expect(row!.slidesReached).toBe(4)
    expect(row!.activeMs).toBe(60_000)
  })

  it('answers 204 for an unknown key rather than erroring', async () => {
    await addSlides(2)
    const res = await complete({
      completionKey: 'not-a-real-key',
      slidesReached: 1,
      activeMs: 1000,
    })
    expect(res.status).toBe(204)
    expect(
      await DeckViewModel.countDocuments({ slidesReached: { $ne: null } }),
    ).toBe(0)
  })

  it('refuses a slug naming no lecture', async () => {
    const res = await complete(
      { completionKey: 'x'.repeat(64), slidesReached: 1, activeMs: 1000 },
      'no-such-lecture',
    )
    expect(res.status).toBe(404)
  })
})
