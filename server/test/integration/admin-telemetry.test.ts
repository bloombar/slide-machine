/**
 * Integration tests for telemetry reporting (SPEC EVAL-1): the summary math
 * against seeded event rows, window behavior (a session spanning the window's
 * edge is reported whole), lecture scoping and name denormalization, the CSV
 * export's shape, and the admin gate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { errorHandler } from '../../src/middleware/error'
import {
  SessionTelemetryEventModel,
  type TelemetryKind,
} from '../../src/models/session-telemetry-event'
import { UserModel } from '../../src/models/user'
import { DeckModel } from '../../src/models/deck'
import {
  deckTelemetry,
  sessionSummaries,
  telemetryOverview,
} from '../../src/telemetry/session-report'
import { signAccessToken } from '../../src/auth/tokens'

const ADMIN_EMAIL = 'admin@example.com'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use(errorHandler)
const server = app.listen(0)

// Anchored a day in the past so a session left unended reads as crashed
// (a recent last event would honestly read as still active instead).
const T0 = new Date(Date.now() - 86_400_000)
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs)

/** Writes one telemetry row; defaults describe a healthy mid-session event. */
const event = async (
  sessionId: string,
  kind: TelemetryKind,
  offsetMs: number,
  over: Record<string, unknown> = {},
) =>
  SessionTelemetryEventModel.create({
    sessionId,
    kind,
    at: at(offsetMs),
    ...over,
  })

/** A minimal valid lecture; telemetry only needs its id and title. */
const makeDeck = async (title: string, over: Record<string, unknown> = {}) => {
  const owner = await UserModel.create({
    email: `owner-${new Types.ObjectId().toString()}@example.com`,
    displayName: 'Owner',
  })
  return DeckModel.create({
    ownerId: owner._id,
    projectId: new Types.ObjectId(),
    templateId: 'classic',
    permalinkSlug: `slug-${new Types.ObjectId().toString()}`,
    title,
    ...over,
  })
}

/** A healthy stopped session: start, two phrases, end. */
const healthySession = async (
  sessionId: string,
  deckId: Types.ObjectId | null = null,
  baseMs = 0,
) => {
  await event(sessionId, 'session_start', baseMs, {
    deckId,
    engine: 'google-cloud',
  })
  await event(sessionId, 'phrase', baseMs + 10_000, {
    deckId,
    outcome: 'new',
    generationMs: 800,
  })
  await event(sessionId, 'phrase', baseMs + 20_000, {
    deckId,
    outcome: 'update',
    generationMs: 1_200,
  })
  await event(sessionId, 'session_end', baseMs + 60_000, {
    deckId,
    endReason: 'stopped',
    capturedMs: 55_000,
  })
}

let adminToken: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([SessionTelemetryEventModel.init(), UserModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    SessionTelemetryEventModel.deleteMany({}),
    UserModel.deleteMany({}),
    DeckModel.deleteMany({}),
  ])
  const admin = await UserModel.create({
    email: ADMIN_EMAIL,
    displayName: 'Admin',
  })
  adminToken = await signAccessToken(admin._id.toString())
})

describe('session summaries', () => {
  it('folds a healthy session into hand-computed figures', async () => {
    await healthySession('sess-1')
    const [summary] = await sessionSummaries({}, {})
    expect(summary).toMatchObject({
      sessionId: 'sess-1',
      phraseCount: 2,
      endReason: 'stopped',
      wallDurationMs: 60_000,
      capturedMs: 55_000,
      excluded: false,
    })
    expect(summary!.generation).toEqual({ count: 2, p50Ms: 800, p95Ms: 1_200 })
  })

  it('reports a session whole even when the window clips its start', async () => {
    await healthySession('sess-edge')
    // The window opens mid-session: the start row is outside it, later rows
    // inside. The session must still report its true start and duration.
    const summaries = await sessionSummaries({}, { from: at(15_000) })
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.startedAt).toBe(at(0).toISOString())
    expect(summaries[0]!.wallDurationMs).toBe(60_000)
  })

  it('excludes sessions entirely outside the window', async () => {
    await healthySession('sess-old')
    const summaries = await sessionSummaries({}, { from: at(120_000) })
    expect(summaries).toHaveLength(0)
  })

  it('scopes to one lecture and resolves its title, even soft-deleted', async () => {
    const deck = await makeDeck('Standing waves', { deletedAt: new Date() })
    await healthySession('sess-mine', deck._id)
    await healthySession('sess-other', null, 300_000)

    const { sessions } = await deckTelemetry(deck._id.toString(), {})
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'sess-mine',
      deckName: 'Standing waves',
    })
  })

  it('totals end states and excludable sessions in the overview', async () => {
    await healthySession('sess-good')
    // A crashed session: started long ago, no end row.
    await event('sess-crash', 'session_start', 100_000)
    await event('sess-crash', 'phrase', 110_000, { outcome: 'new' })
    // An excludable session: an unavailable stretch longer than five minutes.
    await event('sess-outage', 'session_start', 200_000)
    await event('sess-outage', 'generation_error', 210_000, {
      errorKind: 'unavailable',
    })
    await event('sess-outage', 'session_end', 520_000, { endReason: 'stopped' })

    const overview = await telemetryOverview({})
    expect(overview.totals).toMatchObject({
      sessions: 3,
      stopped: 2,
      crashed: 1,
      excludable: 1,
    })
  })
})

describe('the telemetry API', () => {
  const get = (path: string) =>
    request(server).get(path).set('Authorization', `Bearer ${adminToken}`)

  it('serves the overview to an admin', async () => {
    await healthySession('sess-api')
    const res = await get('/api/admin/telemetry')
    expect(res.status).toBe(200)
    expect(res.body.totals.sessions).toBe(1)
    expect(res.body.sessions[0].sessionId).toBe('sess-api')
  })

  it('serves one lecture and rejects a malformed id', async () => {
    const deck = await makeDeck('L1')
    await healthySession('sess-deck', deck._id)

    const ok = await get(`/api/admin/telemetry/decks/${deck._id}`)
    expect(ok.status).toBe(200)
    expect(ok.body.sessions).toHaveLength(1)

    const bad = await get('/api/admin/telemetry/decks/not-an-id')
    expect(bad.status).toBe(400)
  })

  it('rejects an unparseable window date rather than ignoring it', async () => {
    const res = await get('/api/admin/telemetry?from=yesterday-ish')
    expect(res.status).toBe(400)
  })

  it('exports one CSV row per session with the summary columns', async () => {
    await healthySession('sess-csv')
    const res = await get('/api/admin/telemetry/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const [header, first] = res.text.trim().split('\r\n')
    expect(header).toContain('sessionId')
    expect(header).toContain('generationP95Ms')
    expect(header).toContain('endReason')
    expect(first).toContain('sess-csv')
    expect(first).toContain('stopped')
  })

  it.each(['/api/admin/telemetry', '/api/admin/telemetry/export'])(
    'refuses %s without admin',
    async path => {
      const res = await request(server).get(path)
      expect([401, 403]).toContain(res.status)
    },
  )
})
