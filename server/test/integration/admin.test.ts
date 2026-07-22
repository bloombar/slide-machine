/**
 * Integration tests for the admin API against a real MongoDB: allowlist
 * gating, the paginated user directory, and per-user detail, project,
 * and lecture reads. The router self-guards, so the test app mounts it
 * exactly as production wiring would.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { adminRouter } from '../../src/routes/admin'
import { errorHandler } from '../../src/middleware/error'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { AdminPrivateAccessModel } from '../../src/models/admin-private-access'
import { signAccessToken } from '../../src/auth/tokens'

const ADMIN_EMAIL = 'admin@example.com'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use(errorHandler)
const server = app.listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = `${ADMIN_EMAIL}, second-admin@example.com`
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), ProjectModel.init(), DeckModel.init()])
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
  ])
})

/** Creates an account directly (no auth flow) and returns doc + token. */
const createUser = async (email: string, displayName: string) => {
  const user = await UserModel.create({ email, displayName })
  const token = await signAccessToken(user._id.toString())
  return { user, token }
}

const asAdmin = async () => {
  const { token } = await createUser(ADMIN_EMAIL, 'Admin')
  return token
}

const createProject = (
  ownerId: Types.ObjectId,
  title: string,
  extra: Partial<Parameters<typeof ProjectModel.create>[0]> = {},
) => ProjectModel.create({ ownerId, title, ...extra })

const createDeck = (
  ownerId: Types.ObjectId,
  projectId: Types.ObjectId,
  title: string,
  slug: string,
  extra: Partial<Parameters<typeof DeckModel.create>[0]> = {},
) =>
  DeckModel.create({
    ownerId,
    projectId,
    title,
    templateId: 'classic',
    permalinkSlug: slug,
    ...extra,
  })

describe('admin gating', () => {
  it('401s without a token', async () => {
    const res = await request(server).get('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('403s a signed-in non-admin', async () => {
    const { token } = await createUser('user@example.com', 'User')
    const res = await request(server)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  it('GET /status answers only for admins', async () => {
    const admin = await asAdmin()
    const ok = await request(server)
      .get('/api/admin/status')
      .set('Authorization', `Bearer ${admin}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ isAdmin: true })

    const { token } = await createUser('user@example.com', 'User')
    const no = await request(server)
      .get('/api/admin/status')
      .set('Authorization', `Bearer ${token}`)
    expect(no.status).toBe(403)
  })
})

describe('GET /api/admin/users', () => {
  it('lists users with email, handle, and join time', async () => {
    const admin = await asAdmin()
    await createUser('ada@example.com', 'Ada')

    const res = await request(server)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)

    const ada = res.body.users.find(
      (u: { email: string }) => u.email === 'ada@example.com',
    )
    expect(ada).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
      planTier: 'free',
    })
    expect(new Date(ada.createdAt).getTime()).not.toBeNaN()
    expect(ada).not.toHaveProperty('passwordHash')
  })

  it('paginates and reports the total', async () => {
    const admin = await asAdmin()
    for (let i = 0; i < 4; i++) {
      await createUser(`user${i}@example.com`, `User ${i}`)
    }

    const first = await request(server)
      .get('/api/admin/users?page=1&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(first.body.users).toHaveLength(3)
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 3 })

    const second = await request(server)
      .get('/api/admin/users?page=2&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(second.body.users).toHaveLength(2)

    const firstIds = first.body.users.map((u: { id: string }) => u.id)
    for (const u of second.body.users) {
      expect(firstIds).not.toContain(u.id)
    }
  })

  it('sorts by join time (default newest) and by email', async () => {
    const admin = await asAdmin()
    const { user: older } = await createUser('zed@example.com', 'Zed')
    // createdAt is immutable under mongoose timestamps; backdating a
    // fixture needs both escape hatches
    await UserModel.updateOne(
      { _id: older._id },
      { $set: { createdAt: new Date('2020-01-01') } },
      { timestamps: false, overwriteImmutable: true },
    )

    const newest = await request(server)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`)
    expect(newest.body.users.at(-1).email).toBe('zed@example.com')

    const oldest = await request(server)
      .get('/api/admin/users?sort=oldest')
      .set('Authorization', `Bearer ${admin}`)
    expect(oldest.body.users[0].email).toBe('zed@example.com')

    const byEmail = await request(server)
      .get('/api/admin/users?sort=email')
      .set('Authorization', `Bearer ${admin}`)
    expect(byEmail.body.users[0].email).toBe(ADMIN_EMAIL)
  })

  it('400s on an invalid query', async () => {
    const admin = await asAdmin()
    const res = await request(server)
      .get('/api/admin/users?page=0&sort=sideways')
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(res.body.error.details?.length).toBeGreaterThan(0)
  })
})

describe('GET /api/admin/users/:id', () => {
  it('returns full details plus project and lecture counts', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(user._id, 'Physics')
    await createDeck(user._id, project._id, 'Waves', 'waves-abc123')

    const res = await request(server)
      .get(`/api/admin/users/${user._id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({
      id: user._id.toString(),
      email: 'ada@example.com',
      displayName: 'Ada',
      planTier: 'free',
      profileVisibility: 'public',
    })
    expect(res.body.projectCount).toBe(1)
    expect(res.body.deckCount).toBe(1)
  })

  it('404s for unknown and malformed ids', async () => {
    const admin = await asAdmin()
    const unknown = await request(server)
      .get('/api/admin/users/64b000000000000000000000')
      .set('Authorization', `Bearer ${admin}`)
    expect(unknown.status).toBe(404)

    const malformed = await request(server)
      .get('/api/admin/users/not-an-id')
      .set('Authorization', `Bearer ${admin}`)
    expect(malformed.status).toBe(404)
  })
})

describe('GET /api/admin/users/:id/projects', () => {
  it("lists only that user's projects", async () => {
    const admin = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const { user: grace } = await createUser('grace@example.com', 'Grace')
    await createProject(ada._id, 'Physics')
    await createProject(grace._id, 'Compilers')

    const res = await request(server)
      .get(`/api/admin/users/${ada._id}/projects`)
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.projects[0]).toMatchObject({
      title: 'Physics',
      ownerId: ada._id.toString(),
    })
  })
})

describe('GET /api/admin/users/:id/decks', () => {
  it('lists lectures with permalink slugs, filterable by project', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const physics = await createProject(user._id, 'Physics')
    const math = await createProject(user._id, 'Math')
    await createDeck(user._id, physics._id, 'Waves', 'waves-abc123')
    await createDeck(user._id, math._id, 'Limits', 'limits-def456')

    const all = await request(server)
      .get(`/api/admin/users/${user._id}/decks`)
      .set('Authorization', `Bearer ${admin}`)
    expect(all.status).toBe(200)
    expect(all.body.decks).toHaveLength(2)
    expect(
      all.body.decks.map((d: { permalinkSlug: string }) => d.permalinkSlug),
    ).toEqual(expect.arrayContaining(['waves-abc123', 'limits-def456']))

    const filtered = await request(server)
      .get(`/api/admin/users/${user._id}/decks?projectId=${physics._id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(filtered.body.decks).toHaveLength(1)
    expect(filtered.body.decks[0]).toMatchObject({
      title: 'Waves',
      projectId: physics._id.toString(),
      permalinkSlug: 'waves-abc123',
      // Inherits the default project's public visibility.
      visibility: 'public',
      slideCount: 0,
    })
  })

  it('reports slide count and effective visibility per lecture', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    // Private lectures only list while the audited toggle is on
    await request(server)
      .post(`/api/admin/users/${user._id}/private-access`)
      .set('Authorization', `Bearer ${admin}`)
    // A restricted project: its inheriting lecture reads as "restricted".
    const restricted = await createProject(user._id, 'Private course', {
      visibility: 'restricted',
    })
    // A public project whose lecture overrides itself back to restricted.
    const open = await createProject(user._id, 'Open course', {
      visibility: 'public',
    })
    await createDeck(user._id, restricted._id, 'Inherited', 'inherited-a1', {
      slideOrder: ['s1', 's2', 's3'],
    })
    await createDeck(user._id, open._id, 'Overridden', 'overridden-b2', {
      accessOverride: { visibility: 'restricted', viewers: [], editors: [] },
    })

    const res = await request(server)
      .get(`/api/admin/users/${user._id}/decks`)
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    const bySlug = Object.fromEntries(
      res.body.decks.map((d: { permalinkSlug: string }) => [
        d.permalinkSlug,
        d,
      ]),
    )
    expect(bySlug['inherited-a1']).toMatchObject({
      slideCount: 3,
      visibility: 'restricted',
    })
    expect(bySlug['overridden-b2']).toMatchObject({
      slideCount: 0,
      visibility: 'restricted',
    })
  })

  it('400s on a malformed projectId filter', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const res = await request(server)
      .get(`/api/admin/users/${user._id}/decks?projectId=nope`)
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/admin/projects/:id', () => {
  it('returns the project, its owner, and its lectures', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(user._id, 'Physics')
    await createDeck(user._id, project._id, 'Waves', 'waves-abc123', {
      slideOrder: ['s1', 's2'],
    })

    const res = await request(server)
      .get(`/api/admin/projects/${project._id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.project).toMatchObject({
      id: project._id.toString(),
      title: 'Physics',
    })
    expect(res.body.owner).toEqual({
      id: user._id.toString(),
      email: 'ada@example.com',
      displayName: 'Ada',
    })
    expect(res.body.decks).toHaveLength(1)
    expect(res.body.decks[0]).toMatchObject({
      title: 'Waves',
      permalinkSlug: 'waves-abc123',
      visibility: 'public',
      slideCount: 2,
    })
    expect(res.body.privateAccess).toBe(false)
  })

  it('hides private lectures until the audited toggle is on', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(user._id, 'Private course', {
      visibility: 'restricted',
    })
    await createDeck(user._id, project._id, 'Hidden', 'hidden-a1')

    const before = await request(server)
      .get(`/api/admin/projects/${project._id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(before.status).toBe(200)
    expect(before.body.decks).toHaveLength(0)
    expect(before.body.privateAccess).toBe(false)

    await request(server)
      .post(`/api/admin/users/${user._id}/private-access`)
      .set('Authorization', `Bearer ${admin}`)

    const after = await request(server)
      .get(`/api/admin/projects/${project._id}`)
      .set('Authorization', `Bearer ${admin}`)
    expect(after.body.decks).toHaveLength(1)
    expect(after.body.decks[0]).toMatchObject({
      title: 'Hidden',
      visibility: 'restricted',
    })
    expect(after.body.privateAccess).toBe(true)
  })

  it('404s for unknown and malformed ids', async () => {
    const admin = await asAdmin()
    const unknown = await request(server)
      .get('/api/admin/projects/64b000000000000000000000')
      .set('Authorization', `Bearer ${admin}`)
    expect(unknown.status).toBe(404)

    const malformed = await request(server)
      .get('/api/admin/projects/not-an-id')
      .set('Authorization', `Bearer ${admin}`)
    expect(malformed.status).toBe(404)
  })
})
