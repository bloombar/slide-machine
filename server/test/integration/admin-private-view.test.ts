/**
 * Integration tests for admin private-lecture handling against a real
 * MongoDB: allowlisted admins can always open a private lecture in the
 * viewer, the admin deck listing always includes private lectures, and
 * opening a private project in the product view is audited.
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

const listDeckSlugs = async (token: string, userId: Types.ObjectId) => {
  const res = await request(server)
    .get(`/api/admin/users/${userId}/decks`)
    .set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return (res.body.decks as { permalinkSlug: string }[]).map(
    d => d.permalinkSlug,
  )
}

describe('the admin deck listing', () => {
  it('always lists private lectures alongside public ones', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    await createMixedDecks(owner._id, 'abc123')

    expect((await listDeckSlugs(token, owner._id)).sort()).toEqual([
      'open-abc123',
      'secret-abc123',
    ])
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

describe('the private-project view log endpoint', () => {
  const viewProject = (token: string, projectId: string) =>
    request(server)
      .post(`/api/admin/projects/${projectId}/private-view`)
      .set('Authorization', `Bearer ${token}`)

  it('records a distinct entry each time an admin opens a private project', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const project = await ProjectModel.create({
      ownerId: owner._id,
      title: 'Secret course',
      visibility: 'restricted',
    })

    expect((await viewProject(token, project._id.toString())).status).toBe(204)
    expect((await viewProject(token, project._id.toString())).status).toBe(204)

    // Every view is its own access record (unlike the idempotent toggle)
    expect(
      await AdminActionLogModel.countDocuments({
        action: 'project.private_view',
      }),
    ).toBe(2)
    expect(
      await AdminActionLogModel.findOne({ action: 'project.private_view' }),
    ).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      targetType: 'project',
      targetId: project._id.toString(),
      details: {
        title: 'Secret course',
        ownerId: owner._id.toString(),
        visibility: 'restricted',
      },
    })
  })

  it('rejects a public project with 400 and logs nothing', async () => {
    const { token } = await asAdmin()
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const project = await ProjectModel.create({
      ownerId: owner._id,
      title: 'Open course',
      visibility: 'public',
    })

    const res = await viewProject(token, project._id.toString())
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('not_private')
    expect(
      await AdminActionLogModel.countDocuments({
        action: 'project.private_view',
      }),
    ).toBe(0)
  })

  it('404s an unknown or malformed project id', async () => {
    const { token } = await asAdmin()
    expect((await viewProject(token, '507f1f77bcf86cd799439011')).status).toBe(
      404,
    )
    expect((await viewProject(token, 'not-an-id')).status).toBe(404)
  })

  it('gates the endpoint to admins', async () => {
    const { user: owner } = await createUser('owner@example.com', 'Owner')
    const { token } = await createUser('stranger@example.com', 'Stranger')
    const project = await ProjectModel.create({
      ownerId: owner._id,
      title: 'Secret course',
      visibility: 'restricted',
    })

    const anon = await request(server).post(
      `/api/admin/projects/${project._id}/private-view`,
    )
    expect(anon.status).toBe(401)
    const forbidden = await viewProject(token, project._id.toString())
    expect(forbidden.status).toBe(403)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })
})
