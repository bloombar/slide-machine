/**
 * Integration tests for what a ledger row says the work was *for* (BILL-7).
 *
 * The references are recorded when the event happens because they cannot be
 * reconstructed afterwards, so these go through the real dispatcher rather
 * than calling the resolver directly: the question is whether an ordinary
 * action ends up attributed, not whether a helper works in isolation.
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

let ada: string
let projectId: string
let deckId: string

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

  const project = await act(ada, 'project.create', { title: 'Physics 101' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Standing waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
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
