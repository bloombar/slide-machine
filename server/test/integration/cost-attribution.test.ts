/**
 * Integration tests for what a ledger row says the work was *for* (BILL-7).
 *
 * The references are recorded when the event happens because they cannot be
 * reconstructed afterwards, so these go through the real dispatcher rather
 * than calling the resolver directly: the question is whether an ordinary
 * action ends up attributed, not whether a helper works in isolation.
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

// Force the mock TTS adapter (no paid API), the way tts-metering.test.ts
// does — needed by the narration cases below, which are the one path here
// that spends real synthesis rather than an already-mocked action.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TTS_PROVIDER: 'mock' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { CostEventModel } from '../../src/models/cost-event'
import { UsageRecordModel } from '../../src/models/usage-record'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)
afterAll(() => server.close())

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Play a slide's narration. */
const speak = (token: string, slideId: string) =>
  request(server)
    .post(`/api/slides/${slideId}/tts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'content' })

/** Ask for a lecture's translation, the way a reader's client would. */
const translate = (token: string, slug: string, locale: string) =>
  request(server)
    .post(`/api/decks/${slug}/translation`)
    .set('Authorization', `Bearer ${token}`)
    .send({ locale })

let ada: string
let adaId: string
let projectId: string
let deckId: string
let slug: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), CostEventModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    CostEventModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  const res = await request(server).post('/api/auth/register').send({
    email: 'ada@example.com',
    password: 'longenough1',
    displayName: 'Ada',
  })
  ada = res.body.accessToken as string
  await UserModel.updateOne(
    { email: 'ada@example.com' },
    { emailVerified: true },
  )
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()

  const project = await act(ada, 'project.create', { title: 'Physics 101' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Standing waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  await CostEventModel.deleteMany({}) // ignore setup's own metering
})

/** The most recent ledger row. */
const lastEvent = async () =>
  CostEventModel.findOne({}).sort({ _id: -1 }).lean()

describe('an action names what it worked on', () => {
  it('attributes a lecture action to its lecture and project', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })

    const row = await lastEvent()
    expect(row?.metric).toBe('exports')
    expect(row?.deckId?.toString()).toBe(deckId)
    expect(row?.projectId?.toString()).toBe(projectId)
    // Names as they were, so the row still reads after the lecture is gone.
    expect(row?.deckName).toBe('Standing waves')
    expect(row?.projectName).toBe('Physics 101')
  })

  it('reaches the lecture through a slide', async () => {
    // Slide-scoped actions never name a deck, but a slide identifies one — and
    // a lecture identifies a project.
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
    })
    await act(ada, 'slide.editContent', {
      slideId: slide._id.toString(),
      title: 'Antinodes',
    })
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    const rows = await CostEventModel.find({}).lean()
    expect(rows.every(r => r.deckId?.toString() === deckId)).toBe(true)
  })

  it('attributes to the slide named in the input, as well as the deck it resolves to', async () => {
    // `entityFromInput` is the database-backed half of attribution and needs
    // real documents to resolve (see attribution-resolve.test.ts) — exercised
    // directly here, the way the agent-channel case below exercises the
    // ledger writer directly, rather than hunting for an action whose input
    // happens to name a slide and whose provider happens to meter under a
    // mock.
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
    })
    const { entityFromInput } =
      await import('../../src/billing/attribution-resolve')

    // The slide is kept alongside the deck it identifies, not instead of it —
    // BILL-7's per-lecture totals still need the deck.
    const entity = await entityFromInput({ slideId: slide._id.toString() })
    expect(entity.slideId).toBe(slide._id.toString())
    expect(entity.deckId).toBe(deckId)
  })

  it('leaves the slide blank for an action that names only a deck', async () => {
    // A whole-lecture action, like exporting the deck, has no one slide to
    // name — blank means "not slide-specific", not "unknown".
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    const row = await lastEvent()
    expect(row?.slideId).toBeFalsy()
    expect(row?.deckId?.toString()).toBe(deckId)
  })

  it('marks an owner’s own work as theirs', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    const row = await lastEvent()
    expect(row?.actorKind).toBe('owner')
    expect(row?.actorId?.toString()).toBe(row?.payerId.toString())
  })

  it('still records the payer for an action that names nothing', async () => {
    // The per-user roll-up works even where the per-lecture one is blind.
    await act(ada, 'project.create', { title: 'Another' })
    const rows = await CostEventModel.find({}).lean()
    for (const row of rows) expect(row.payerId).toBeTruthy()
  })
})

describe('how the request arrived', () => {
  it('marks an ordinary action as coming through the app', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    expect((await lastEvent())?.channel).toBe('app')
  })

  it('carries an agent channel from the ambient attribution onto the row', async () => {
    // Deliberately not through a tool call: no action an assistant can reach
    // spends anything today — the agent surface excludes generation, exports,
    // imports and quizzes, which is every metered path there is (docs/MCP.md
    // §6). So this exercises the ledger writer directly, and says so, rather
    // than dressing a synthetic context up as an end-to-end result. What it
    // proves is narrow and real: when a metered action does become reachable,
    // the row will say an assistant caused it.
    const { runWithUsage } = await import('../../src/billing/usage-attribution')
    const { recordCostEvent } = await import('../../src/billing/cost-ledger')
    const payerId = (await UserModel.findOne({
      email: 'ada@example.com',
    }))!._id.toString()

    await runWithUsage(
      { userId: payerId, actorId: payerId, channel: 'agent' },
      () => recordCostEvent({ payerId, metric: 'exports', quantity: 1 }),
    )

    const row = await lastEvent()
    expect(row?.channel).toBe('agent')
    // The channel says how it arrived; actorKind still says who, and the two
    // must not have collapsed into one another.
    expect(row?.actorKind).toBe('owner')
  })
})

describe('narration is for one slide', () => {
  // Unique per call: the audio cache lives on disk and outlives the
  // database, so a fixed body would make the first call of a re-run a hit.
  const makeSlide = async (): Promise<string> => {
    const nonce = Math.random().toString(36).slice(2)
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
      body: `Waves interfere ${nonce}`,
    })
    return slide._id.toString()
  }

  it('records the slide a synthesis was for, on a cache miss', async () => {
    const slideId = await makeSlide()
    const res = await speak(ada, slideId)
    expect(res.status).toBe(200)

    const row = await CostEventModel.findOne({
      metric: 'ttsCharacters',
    }).lean()
    expect(row?.slideId?.toString()).toBe(slideId)
    expect(row?.deckId?.toString()).toBe(deckId)
    expect(row?.billable).toBe(true)
  })

  it('records the slide a synthesis was for, on a cache hit too', async () => {
    // The path the study depends on most: almost every play in a real class
    // is a hit against audio a first listener already paid to produce.
    const slideId = await makeSlide()
    await speak(ada, slideId) // fills the cache
    await CostEventModel.deleteMany({}) // ignore the miss's own row

    const res = await speak(ada, slideId) // served from the cache
    expect(res.status).toBe(200)

    const row = await CostEventModel.findOne({
      metric: 'ttsCharacters',
    }).lean()
    expect(row?.slideId?.toString()).toBe(slideId)
    expect(row?.billable).toBe(false)
  })
})

describe('translating a whole lecture is not for one slide', () => {
  it('writes no slideId for a whole-deck translation', async () => {
    await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
      body: 'A wave that stays in place.',
    })
    const res = await translate(ada, slug, 'es')
    expect(res.status).toBe(200)

    const row = await CostEventModel.findOne({
      metric: 'translationCharacters',
    }).lean()
    expect(row).toBeTruthy()
    expect(row?.deckId?.toString()).toBe(deckId)
    // Blank means "not slide-specific" — a deck translation touches every
    // slide, so no single one names the work.
    expect(row?.slideId).toBeFalsy()
  })
})

describe('the sameParty guard', () => {
  it('drops the slide, like the deck and project, when the payer differs from the ambient context', async () => {
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
    })
    const { runWithUsage } = await import('../../src/billing/usage-attribution')
    const { recordCostEvent } = await import('../../src/billing/cost-ledger')
    const { Types } = await import('mongoose')
    const otherPayer = new Types.ObjectId().toString()

    // The outer context belongs to Ada and names her deck and slide; the
    // nested call spends on a different account entirely. That account's row
    // must not inherit Ada's entity references.
    await runWithUsage(
      {
        userId: adaId,
        actorId: adaId,
        deckId,
        deckName: 'Standing waves',
        slideId: slide._id.toString(),
      },
      () =>
        recordCostEvent({
          payerId: otherPayer,
          metric: 'exports',
          quantity: 1,
        }),
    )

    const row = await lastEvent()
    expect(row?.payerId.toString()).toBe(otherPayer)
    expect(row?.deckId).toBeNull()
    expect(row?.slideId).toBeNull()
  })
})

describe('pricing is unchanged by this slice', () => {
  it('prices a narration event exactly as it would have before slideId existed', async () => {
    const { costMicrosFor } = await import('../../src/billing/pricing')
    const slide = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Nodes',
      body: `Waves interfere ${Math.random().toString(36).slice(2)}`,
    })
    const res = await speak(ada, slide._id.toString())
    expect(res.status).toBe(200)

    const row = await CostEventModel.findOne({
      metric: 'ttsCharacters',
    }).lean()
    expect(row).toBeTruthy()
    expect(row!.billable).toBe(true)
    expect(row!.quantity).toBeGreaterThan(0)
    // The figure the pricing table produces for this quantity, independent
    // of anything this slice touched — recording which slide the work was
    // for must not move what it cost.
    expect(row!.costMicros).toBe(costMicrosFor('ttsCharacters', row!.quantity))
  })
})

describe('the reports see it', () => {
  it('rolls a lecture’s spend up under that lecture', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    const { costSummary } = await import('../../src/billing/cost-report')
    const summary = await costSummary({ deckId })
    // Exports are metered but not vendor-invoiced, so the row exists at zero:
    // the count is the point, not the money.
    expect(
      summary.byMetric.find(m => m.metric === 'exports')?.events,
    ).toBeGreaterThan(0)
  })
})
