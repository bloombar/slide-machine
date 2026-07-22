/**
 * Integration tests for the admin private-view grant against a real
 * MongoDB: the toggle endpoints (audited enable/disable, off by
 * default), the deck-viewer bypass they unlock, and the audit entry
 * every private view leaves behind.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { decksRouter } from '../../src/routes/decks'
import { errorHandler } from '../../src/middleware/error'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { AdminPrivateAccessModel } from '../../src/models/admin-private-access'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import { signAccessToken } from '../../src/auth/tokens'

const ADMIN_EMAIL = 'admin@example.com'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use('/api', decksRouter)
app.use(errorHandler)
const server = app.listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    AdminPrivateAccessModel.deleteMany({}),
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

/** A user owning one private (restricted) lecture; returns its slug. */
const createPrivateDeck = async (ownerId: Types.ObjectId, slug: string) => {
  const project = await ProjectModel.create({
    ownerId,
    title: 'Secret course',
    visibility: 'restricted',
  })
  return DeckModel.create({
    ownerId,
    projectId: project._id,
    title: 'Secret lecture',
    templateId: 'classic',
    permalinkSlug: slug,
  })
}

const enableAccess = (token: string, userId: Types.ObjectId) =>
  request(server)
    .post(`/api/admin/users/${userId}/private-access`)
    .set('Authorization', `Bearer ${token}`)

const readDetail = async (token: string, userId: Types.ObjectId) =>
  (
    await request(server)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
  ).body as { privateAccess: boolean }

describe('the private-view toggle endpoints', () => {
  it('is off by default and flips on/off with audited transitions', async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')

    expect((await readDetail(token, user._id)).privateAccess).toBe(false)

    expect((await enableAccess(token, user._id)).status).toBe(204)
    expect((await readDetail(token, user._id)).privateAccess).toBe(true)
    expect(
      await AdminActionLogModel.findOne({
        action: 'user.private_view_enabled',
      }),
    ).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      targetType: 'user',
      targetId: user._id.toString(),
      details: { email: 'owner@example.com' },
    })

    // Re-enabling is idempotent: one grant, one enabled entry
    expect((await enableAccess(token, user._id)).status).toBe(204)
    expect(await AdminPrivateAccessModel.countDocuments()).toBe(1)
    expect(
      await AdminActionLogModel.countDocuments({
        action: 'user.private_view_enabled',
      }),
    ).toBe(1)

    const off = await request(server)
      .delete(`/api/admin/users/${user._id}/private-access`)
      .set('Authorization', `Bearer ${token}`)
    expect(off.status).toBe(204)
    expect((await readDetail(token, user._id)).privateAccess).toBe(false)
    expect(
      await AdminActionLogModel.countDocuments({
        action: 'user.private_view_disabled',
      }),
    ).toBe(1)

    // Disabling an already-off grant logs nothing new
    await request(server)
      .delete(`/api/admin/users/${user._id}/private-access`)
      .set('Authorization', `Bearer ${token}`)
    expect(
      await AdminActionLogModel.countDocuments({
        action: 'user.private_view_disabled',
      }),
    ).toBe(1)
  })

  it('gates the endpoints to admins', async () => {
    const { user, token } = await createUser('user@example.com', 'User')
    const anon = await request(server).post(
      `/api/admin/users/${user._id}/private-access`,
    )
    expect(anon.status).toBe(401)
    const forbidden = await enableAccess(token, user._id)
    expect(forbidden.status).toBe(403)
  })
})

describe('the deck-viewer private-view bypass', () => {
  it('404s private decks for an admin until the grant is enabled, then logs each view', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const deck = await createPrivateDeck(owner._id, 'secret-abc123')

    // Without the grant: same 404 as any stranger
    const before = await request(server)
      .get('/api/decks/secret-abc123')
      .set('Authorization', `Bearer ${token}`)
    expect(before.status).toBe(404)

    await enableAccess(token, owner._id)

    const after = await request(server)
      .get('/api/decks/secret-abc123')
      .set('Authorization', `Bearer ${token}`)
    expect(after.status).toBe(200)
    expect(after.body.deck.title).toBe('Secret lecture')
    // View-only: the grant never confers editing
    expect(after.body.canEdit).toBe(false)

    expect(
      await AdminActionLogModel.findOne({ action: 'deck.private_view' }),
    ).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      targetType: 'deck',
      targetId: deck._id.toString(),
      details: { title: 'Secret lecture', ownerId: owner._id.toString() },
    })
  })

  it('never admits a non-admin, even with a forged grant row', async () => {
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const { user: sneak, token } = await createUser(
      'sneak@example.com',
      'Sneak',
    )
    await createPrivateDeck(owner._id, 'secret-def456')
    // A grant row without allowlist membership must be inert
    await AdminPrivateAccessModel.create({
      adminId: sneak._id,
      targetUserId: owner._id,
    })

    const res = await request(server)
      .get('/api/decks/secret-def456')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(
      await AdminActionLogModel.countDocuments({ action: 'deck.private_view' }),
    ).toBe(0)
  })

  it('does not log admin views of public decks', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const project = await ProjectModel.create({
      ownerId: owner._id,
      title: 'Open course',
      visibility: 'public',
    })
    await DeckModel.create({
      ownerId: owner._id,
      projectId: project._id,
      title: 'Open lecture',
      templateId: 'classic',
      permalinkSlug: 'open-abc123',
    })
    await enableAccess(token, owner._id)

    const res = await request(server)
      .get('/api/decks/open-abc123')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(
      await AdminActionLogModel.countDocuments({ action: 'deck.private_view' }),
    ).toBe(0)
  })

  it("a grant for one user never opens another user's lectures", async () => {
    const { token } = await asAdmin()
    const { user: granted } = await createUser('granted@example.com', 'A')
    const { user: other } = await createUser('other@example.com', 'B')
    await createPrivateDeck(other._id, 'other-abc123')
    await enableAccess(token, granted._id)

    const res = await request(server)
      .get('/api/decks/other-abc123')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})
