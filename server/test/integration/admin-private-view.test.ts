/**
 * Integration tests for admin private-lecture handling against a real
 * MongoDB: allowlisted admins can always open a private lecture in the
 * viewer, while the audited "show private lectures" toggle governs only
 * whether the admin deck listing includes them.
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

/** A user owning one public and one private lecture; returns both. */
const createMixedDecks = async (ownerId: Types.ObjectId, tag: string) => {
  const openProject = await ProjectModel.create({
    ownerId,
    title: 'Open course',
    visibility: 'public',
  })
  const secretProject = await ProjectModel.create({
    ownerId,
    title: 'Secret course',
    visibility: 'restricted',
  })
  const publicDeck = await DeckModel.create({
    ownerId,
    projectId: openProject._id,
    title: 'Open lecture',
    templateId: 'classic',
    permalinkSlug: `open-${tag}`,
  })
  const privateDeck = await DeckModel.create({
    ownerId,
    projectId: secretProject._id,
    title: 'Secret lecture',
    templateId: 'classic',
    permalinkSlug: `secret-${tag}`,
  })
  return { publicDeck, privateDeck }
}

const enableAccess = (token: string, userId: Types.ObjectId) =>
  request(server)
    .post(`/api/admin/users/${userId}/private-access`)
    .set('Authorization', `Bearer ${token}`)

const listDeckSlugs = async (token: string, userId: Types.ObjectId) => {
  const res = await request(server)
    .get(`/api/admin/users/${userId}/decks`)
    .set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return (res.body.decks as { permalinkSlug: string }[]).map(
    d => d.permalinkSlug,
  )
}

const readDetail = async (token: string, userId: Types.ObjectId) =>
  (
    await request(server)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
  ).body as { privateAccess: boolean }

describe('the show-private-lectures toggle endpoints', () => {
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

    // Disabling an already-off toggle logs nothing new
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

describe('the admin deck listing', () => {
  it('hides private lectures until the toggle is on', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    await createMixedDecks(owner._id, 'abc123')

    expect(await listDeckSlugs(token, owner._id)).toEqual(['open-abc123'])

    await enableAccess(token, owner._id)
    expect((await listDeckSlugs(token, owner._id)).sort()).toEqual([
      'open-abc123',
      'secret-abc123',
    ])
  })

  it("one admin's toggle never affects another admin's listing", async () => {
    const { token } = await asAdmin()
    const { user: second, token: secondToken } = await createUser(
      'second-admin@example.com',
      'Second',
    )
    process.env.ADMIN_EMAILS = `${ADMIN_EMAIL}, second-admin@example.com`
    try {
      const { user: owner } = await createUser('owner@example.com', 'Owner')
      await createMixedDecks(owner._id, 'def456')
      await enableAccess(token, owner._id)

      expect((await listDeckSlugs(token, owner._id)).sort()).toEqual([
        'open-def456',
        'secret-def456',
      ])
      // The second admin left their toggle off
      expect(await listDeckSlugs(secondToken, owner._id)).toEqual([
        'open-def456',
      ])
      expect(second.email).toBe('second-admin@example.com')
    } finally {
      process.env.ADMIN_EMAILS = ADMIN_EMAIL
    }
  })
})

describe('the deck-viewer admin bypass', () => {
  it('always opens a private lecture read-only for an admin, toggle or not', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    await createMixedDecks(owner._id, 'ghi789')

    const res = await request(server)
      .get('/api/decks/secret-ghi789')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.deck.title).toBe('Secret lecture')
    // View-only: admin status never confers editing
    expect(res.body.canEdit).toBe(false)
  })

  it('still 404s private lectures for non-admins and anonymous visitors', async () => {
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const { token } = await createUser('stranger@example.com', 'Stranger')
    await createMixedDecks(owner._id, 'jkl012')

    const anon = await request(server).get('/api/decks/secret-jkl012')
    expect(anon.status).toBe(404)
    const stranger = await request(server)
      .get('/api/decks/secret-jkl012')
      .set('Authorization', `Bearer ${token}`)
    expect(stranger.status).toBe(404)
  })
})
