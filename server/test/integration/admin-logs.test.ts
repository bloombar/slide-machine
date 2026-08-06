/**
 * Integration tests for the admin audit log against a real MongoDB:
 * allowlist gating, the paginated newest-first listing, and the CSV
 * export (headers, escaping, ordering). Entries are seeded through the
 * real logAdminAction write path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { errorHandler } from '../../src/middleware/error'
import { UserModel } from '../../src/models/user'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import { logAdminAction } from '../../src/audit/log'
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
  await Promise.all([UserModel.init(), AdminActionLogModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    AdminActionLogModel.deleteMany({}),
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

/** Seeds `count` entries through the real logger, oldest first. */
const seedEntries = async (actorId: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await logAdminAction({
      actorId,
      actorEmail: ADMIN_EMAIL,
      action: 'user.delete',
      targetType: 'user',
      targetId: `target-${i}`,
    })
  }
}

describe('audit log gating', () => {
  it('401s without a token on both endpoints', async () => {
    expect((await request(server).get('/api/admin/logs')).status).toBe(401)
    expect((await request(server).get('/api/admin/logs/export')).status).toBe(
      401,
    )
  })

  it('403s a signed-in non-admin on both endpoints', async () => {
    const { token } = await createUser('user@example.com', 'User')
    const list = await request(server)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(403)
    expect(list.body.error.code).toBe('forbidden')

    const csv = await request(server)
      .get('/api/admin/logs/export')
      .set('Authorization', `Bearer ${token}`)
    expect(csv.status).toBe(403)
  })
})

describe('GET /api/admin/logs', () => {
  it('returns the empty log', async () => {
    const { token } = await asAdmin()
    const res = await request(server)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ logs: [], total: 0, page: 1, limit: 25 })
  })

  it('lists entries newest first with the full wire shape', async () => {
    const { admin, token } = await asAdmin()
    await logAdminAction({
      actorId: admin._id.toString(),
      actorEmail: ADMIN_EMAIL,
      action: 'user.ban',
      targetType: 'user',
      targetId: 'u-1',
      details: { reason: 'spam' },
    })
    await logAdminAction({
      actorId: admin._id.toString(),
      actorEmail: ADMIN_EMAIL,
      action: 'deck.delete',
    })

    const res = await request(server)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    // Newest (deck.delete) first
    expect(res.body.logs.map((l: { action: string }) => l.action)).toEqual([
      'deck.delete',
      'user.ban',
    ])
    expect(res.body.logs[1]).toMatchObject({
      actorId: admin._id.toString(),
      actorEmail: ADMIN_EMAIL,
      action: 'user.ban',
      targetType: 'user',
      targetId: 'u-1',
      details: { reason: 'spam' },
    })
    expect(new Date(res.body.logs[0].createdAt).getTime()).not.toBeNaN()
  })

  it('paginates, reports the total, and supports oldest-first sort', async () => {
    const { admin, token } = await asAdmin()
    await seedEntries(admin._id.toString(), 5)

    const first = await request(server)
      .get('/api/admin/logs?page=1&limit=3')
      .set('Authorization', `Bearer ${token}`)
    expect(first.body.logs).toHaveLength(3)
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 3 })

    const second = await request(server)
      .get('/api/admin/logs?page=2&limit=3')
      .set('Authorization', `Bearer ${token}`)
    expect(second.body.logs).toHaveLength(2)
    const firstIds = first.body.logs.map((l: { id: string }) => l.id)
    for (const l of second.body.logs) {
      expect(firstIds).not.toContain(l.id)
    }

    const oldest = await request(server)
      .get('/api/admin/logs?sort=time:asc&limit=1')
      .set('Authorization', `Bearer ${token}`)
    expect(oldest.body.logs[0].targetId).toBe('target-0')
  })

  it('sorts by each column the page offers, in both directions', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    // Seeded so no two columns agree on an order: whichever column is
    // asked for, a wrong one would produce a visibly different sequence.
    await logAdminAction({
      actorId,
      actorEmail: 'carol@example.com',
      action: 'deck.delete',
      targetType: 'user',
      targetId: 'u-1',
      details: { email: 'zoe@example.com' },
    })
    await logAdminAction({
      actorId,
      actorEmail: 'alice@example.com',
      action: 'user.delete',
      targetType: 'project',
      targetId: 'p-1',
      details: { title: 'Zebras' },
    })
    await logAdminAction({
      actorId,
      actorEmail: 'bob@example.com',
      action: 'project.restore',
      targetType: 'deck',
      targetId: 'd-1',
      details: { title: 'Amber' },
    })

    const order = async (sort: string): Promise<string[]> => {
      const res = await request(server)
        .get(`/api/admin/logs?sort=${sort}`)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      return res.body.logs.map((l: { targetId: string }) => l.targetId)
    }

    expect(await order('admin:asc')).toEqual(['p-1', 'd-1', 'u-1'])
    expect(await order('admin:desc')).toEqual(['u-1', 'd-1', 'p-1'])
    expect(await order('action:asc')).toEqual(['u-1', 'd-1', 'p-1'])
    expect(await order('action:desc')).toEqual(['p-1', 'd-1', 'u-1'])
    expect(await order('target:asc')).toEqual(['d-1', 'p-1', 'u-1'])
    expect(await order('target:desc')).toEqual(['u-1', 'p-1', 'd-1'])
  })

  it('orders the target column by kind, then by the name it shows', async () => {
    const { admin, token } = await asAdmin()
    const actorId = admin._id.toString()
    // Names live in details — an email for users, a title for the rest —
    // so the column has to read both to order what it displays.
    for (const entry of [
      { targetType: 'project', targetId: 'p-zebras', title: 'Zebras' },
      { targetType: 'user', targetId: 'u-1' },
      { targetType: 'project', targetId: 'p-amber', title: 'Amber' },
    ]) {
      await logAdminAction({
        actorId,
        actorEmail: ADMIN_EMAIL,
        action: `${entry.targetType}.delete`,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details: entry.title
          ? { title: entry.title }
          : { email: 'anna@example.com' },
      })
    }

    const res = await request(server)
      .get('/api/admin/logs?sort=target:asc')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.logs.map((l: { targetId: string }) => l.targetId)).toEqual([
      'p-amber',
      'p-zebras',
      'u-1',
    ])
  })

  it('400s on an invalid query', async () => {
    const { token } = await asAdmin()
    const res = await request(server)
      .get('/api/admin/logs?page=0&sort=sideways')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(res.body.error.details?.length).toBeGreaterThan(0)
  })
})

describe('GET /api/admin/logs/export', () => {
  it('serves an attachment with the CSV header row even when empty', async () => {
    const { token } = await asAdmin()
    const res = await request(server)
      .get('/api/admin/logs/export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="admin-audit-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    )
    expect(res.text).toBe(
      'createdAt,actorEmail,actorId,action,targetType,targetId,details\r\n',
    )
  })

  it('exports every entry newest first with escaped fields', async () => {
    const { admin, token } = await asAdmin()
    await logAdminAction({
      actorId: admin._id.toString(),
      actorEmail: ADMIN_EMAIL,
      action: 'user.ban',
      targetType: 'user',
      targetId: 'u-1',
      details: { reason: 'used "quotes", commas' },
    })
    await logAdminAction({
      actorId: admin._id.toString(),
      actorEmail: ADMIN_EMAIL,
      action: 'deck.delete',
    })

    const res = await request(server)
      .get('/api/admin/logs/export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const lines = res.text.split('\r\n').filter(line => line !== '')
    expect(lines).toHaveLength(3)
    // Newest (deck.delete) first, absent optional fields empty
    expect(lines[1]).toContain('deck.delete,,,')
    // details JSON is quote-wrapped with internal quotes doubled
    expect(lines[2]).toContain('user.ban,user,u-1,')
    expect(lines[2]).toContain('"{""reason"":""used \\""quotes\\"", commas""}"')
  })
})
