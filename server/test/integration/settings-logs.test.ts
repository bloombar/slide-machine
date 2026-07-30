/**
 * Integration tests for the settings change log's read API against a real
 * MongoDB: allowlist gating, the paginated newest-first listing, the
 * entity/owner filters, and the CSV export (headers, escaping, ordering,
 * and that it honours the same filters). Entries are seeded through the
 * real logSettingsChange write path, except where a test needs entries
 * sharing one timestamp to pin down the ordering.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { errorHandler } from '../../src/middleware/error'
import { UserModel } from '../../src/models/user'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'
import { logSettingsChange } from '../../src/audit/settings-log'
import { signAccessToken } from '../../src/auth/tokens'

const ADMIN_EMAIL = 'admin@example.com'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use(errorHandler)
const server = app.listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), SettingsChangeLogModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
})

/** Creates an account directly (no auth flow) and returns doc + token. */
const createUser = async (email: string, displayName: string) => {
  const user = await UserModel.create({ email, displayName })
  const token = await signAccessToken(user._id.toString())
  return { user, token }
}

const asAdmin = async () => {
  const { user, token } = await createUser(ADMIN_EMAIL, 'Admin')
  return { admin: user, token }
}

/** Seeds one entry through the real logger. */
const seed = (
  actorId: string,
  entity: { entityType: 'user' | 'project' | 'deck'; entityId: string },
  ownerId = 'owner-1',
) =>
  logSettingsChange({
    actorId,
    actorEmail: ADMIN_EMAIL,
    actorRole: 'owner',
    entityName: 'Physics',
    ownerId,
    changes: { language: { from: null, to: 'fr' } },
    ...entity,
  })

/**
 * Seeds `count` entries (`e-0`…`e-N`) that all share one createdAt, in
 * order. Bypasses the logger — the only way to guarantee the tie that the
 * ordering depends on, which real writes hit only by chance. Insert order
 * is the true order, and the ObjectIds record it.
 */
const seedSameInstant = (actorId: string, count: number) =>
  SettingsChangeLogModel.insertMany(
    Array.from({ length: count }, (_, i) => ({
      actorId,
      actorEmail: ADMIN_EMAIL,
      actorRole: 'owner',
      entityType: 'project',
      entityId: `e-${i}`,
      entityName: 'Physics',
      ownerId: 'owner-1',
      changes: { language: { from: null, to: 'fr' } },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
    { timestamps: false },
  )

const get = (token: string, path: string) =>
  request(server).get(path).set('Authorization', `Bearer ${token}`)

/** The entityIds of a listing response, in the order returned. */
const idsOf = (res: { body: { logs: { entityId: string }[] } }) =>
  res.body.logs.map(l => l.entityId)

describe('settings log gating', () => {
  it('401s without a token on both endpoints', async () => {
    expect((await request(server).get('/api/admin/settings-logs')).status).toBe(
      401,
    )
    expect(
      (await request(server).get('/api/admin/settings-logs/export')).status,
    ).toBe(401)
  })

  it('403s a signed-in non-admin on both endpoints', async () => {
    const { token } = await createUser('user@example.com', 'User')
    const list = await get(token, '/api/admin/settings-logs')
    expect(list.status).toBe(403)
    expect(list.body.error.code).toBe('forbidden')

    const csv = await get(token, '/api/admin/settings-logs/export')
    expect(csv.status).toBe(403)
  })
})

describe('GET /api/admin/settings-logs', () => {
  it('returns the empty log', async () => {
    const { token } = await asAdmin()
    const res = await get(token, '/api/admin/settings-logs')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ logs: [], total: 0, page: 1, limit: 25 })
  })

  it('lists entries newest first with the full wire shape', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    await seed(actorId, { entityType: 'project', entityId: 'p-1' }, 'u-1')
    await seed(actorId, { entityType: 'deck', entityId: 'd-1' }, 'u-1')

    const res = await get(token, '/api/admin/settings-logs')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    // Newest (the lecture) first
    expect(res.body.logs.map((l: { entityId: string }) => l.entityId)).toEqual([
      'd-1',
      'p-1',
    ])
    expect(res.body.logs[1]).toMatchObject({
      actorId,
      actorEmail: ADMIN_EMAIL,
      actorRole: 'owner',
      entityType: 'project',
      entityId: 'p-1',
      entityName: 'Physics',
      ownerId: 'u-1',
      changes: { language: { from: null, to: 'fr' } },
    })
    expect(new Date(res.body.logs[0].createdAt).getTime()).not.toBeNaN()
  })

  it('paginates, reports the total, and supports oldest-first sort', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    for (let i = 0; i < 5; i++) {
      await seed(actorId, { entityType: 'user', entityId: `u-${i}` })
    }

    const first = await get(token, '/api/admin/settings-logs?page=1&limit=3')
    expect(first.body.logs).toHaveLength(3)
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 3 })

    const second = await get(token, '/api/admin/settings-logs?page=2&limit=3')
    expect(second.body.logs).toHaveLength(2)
    const firstIds = first.body.logs.map((l: { id: string }) => l.id)
    for (const entry of second.body.logs) {
      expect(firstIds).not.toContain(entry.id)
    }

    const oldest = await get(
      token,
      '/api/admin/settings-logs?sort=oldest&limit=1',
    )
    expect(oldest.body.logs[0].entityId).toBe('u-0')
  })

  it('orders entries written in the same millisecond by when they happened', async () => {
    const { admin, token } = await asAdmin()
    await seedSameInstant(admin._id.toString(), 5)

    const newest = await get(token, '/api/admin/settings-logs')
    expect(idsOf(newest)).toEqual(['e-4', 'e-3', 'e-2', 'e-1', 'e-0'])

    const oldest = await get(token, '/api/admin/settings-logs?sort=oldest')
    expect(idsOf(oldest)).toEqual(['e-0', 'e-1', 'e-2', 'e-3', 'e-4'])

    // A tie must not let a row repeat on one page and vanish from the next
    const [one, two] = await Promise.all([
      get(token, '/api/admin/settings-logs?page=1&limit=3'),
      get(token, '/api/admin/settings-logs?page=2&limit=3'),
    ])
    expect([...idsOf(one), ...idsOf(two)]).toEqual([
      'e-4',
      'e-3',
      'e-2',
      'e-1',
      'e-0',
    ])
  })

  it('filters by entity kind, and counts only what it returns', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    await seed(actorId, { entityType: 'user', entityId: 'u-1' })
    await seed(actorId, { entityType: 'project', entityId: 'p-1' })
    await seed(actorId, { entityType: 'project', entityId: 'p-2' })

    const res = await get(token, '/api/admin/settings-logs?entityType=project')
    expect(res.body.total).toBe(2)
    expect(res.body.logs).toHaveLength(2)
    for (const entry of res.body.logs) {
      expect(entry.entityType).toBe('project')
    }
  })

  it('follows one record, and one account, through the log', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    await seed(actorId, { entityType: 'project', entityId: 'p-1' }, 'u-1')
    await seed(actorId, { entityType: 'deck', entityId: 'd-1' }, 'u-1')
    await seed(actorId, { entityType: 'deck', entityId: 'd-2' }, 'u-2')

    const record = await get(token, '/api/admin/settings-logs?entityId=p-1')
    expect(record.body.total).toBe(1)
    expect(record.body.logs[0].entityId).toBe('p-1')

    // Everything belonging to one owner, whatever kind it is
    const account = await get(token, '/api/admin/settings-logs?ownerId=u-1')
    expect(account.body.total).toBe(2)
    expect(
      account.body.logs.map((l: { entityId: string }) => l.entityId).sort(),
    ).toEqual(['d-1', 'p-1'])
  })

  it('400s on an invalid query', async () => {
    const { token } = await asAdmin()
    const res = await get(
      token,
      '/api/admin/settings-logs?page=0&entityType=slide',
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(res.body.error.details?.length).toBeGreaterThan(0)
  })
})

describe('GET /api/admin/settings-logs/export', () => {
  it('serves an attachment with the CSV header row even when empty', async () => {
    const { token } = await asAdmin()
    const res = await get(token, '/api/admin/settings-logs/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="settings-change-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    )
    expect(res.text).toBe(
      'createdAt,actorEmail,actorId,actorRole,entityType,entityId,entityName,ownerId,changes\r\n',
    )
  })

  it('exports every entry newest first with escaped fields', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    await logSettingsChange({
      actorId,
      actorEmail: ADMIN_EMAIL,
      actorRole: 'admin',
      entityType: 'project',
      entityId: 'p-1',
      entityName: 'Waves, "advanced"',
      ownerId: 'u-1',
      changes: { title: { from: 'Waves', to: 'Waves, "advanced"' } },
    })
    await seed(actorId, { entityType: 'deck', entityId: 'd-1' })

    const res = await get(token, '/api/admin/settings-logs/export')
    expect(res.status).toBe(200)

    const lines = res.text.split('\r\n').filter(line => line !== '')
    expect(lines).toHaveLength(3)
    // Newest (the lecture) first
    expect(lines[1]).toContain('owner,deck,d-1,Physics')
    // A name with a comma and quotes is quote-wrapped, quotes doubled
    expect(lines[2]).toContain('"Waves, ""advanced"""')
    expect(lines[2]).toContain('""from"":""Waves""')
  })

  it('exports same-millisecond entries in the listing order', async () => {
    const { admin, token } = await asAdmin()
    await seedSameInstant(admin._id.toString(), 3)

    const res = await get(token, '/api/admin/settings-logs/export')
    const rows = res.text
      .split('\r\n')
      .filter(line => line !== '')
      .slice(1)
    expect(rows.map(row => row.split(',')[5])).toEqual(['e-2', 'e-1', 'e-0'])
  })

  it('honours the same filters as the listing', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    await seed(actorId, { entityType: 'user', entityId: 'u-1' })
    await seed(actorId, { entityType: 'project', entityId: 'p-1' })

    const res = await get(
      token,
      '/api/admin/settings-logs/export?entityType=project',
    )
    const lines = res.text.split('\r\n').filter(line => line !== '')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('project,p-1')
  })
})
