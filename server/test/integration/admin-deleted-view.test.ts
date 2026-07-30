/**
 * Integration tests for viewing soft-deleted content in the admin console
 * (ADMIN-6) against a real MongoDB: the detail reads resolve tombstoned
 * users, projects, and lectures instead of 404ing, they carry the
 * `deletedAt` the console badges, they still resolve context whose parents
 * were deleted in the same cascade, and every opening leaves exactly one
 * audit entry (ADMIN-7). The moderation endpoints, by contrast, must keep
 * refusing a tombstoned target — a deleted record is restored, not
 * moderated again.
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
import { SeedAssetModel } from '../../src/models/seed-asset'
import { SlideModel } from '../../src/models/slide'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefineJobModel } from '../../src/models/refine-job'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import {
  deleteDeckCascade,
  deleteProjectCascade,
  deleteUserCascade,
} from '../../src/lib/cascade'
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
    SeedAssetModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefineJobModel.deleteMany({}),
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
  const { token } = await createUser(ADMIN_EMAIL, 'Admin')
  return token
}

const createProject = (
  ownerId: Types.ObjectId,
  title: string,
  extra: Record<string, unknown> = {},
) => ProjectModel.create({ ownerId, title, ...extra })

const createDeck = (
  ownerId: Types.ObjectId,
  projectId: Types.ObjectId,
  title: string,
  slug: string,
) =>
  DeckModel.create({
    ownerId,
    projectId,
    title,
    templateId: 'classic',
    permalinkSlug: slug,
  })

/** The audit entries written so far, oldest first. */
const auditLog = () => AdminActionLogModel.find().sort({ createdAt: 1, _id: 1 })

const get = (path: string, token: string) =>
  request(server).get(path).set('Authorization', `Bearer ${token}`)

describe('GET /api/admin/users/:id on a soft-deleted account', () => {
  it('returns the account with its tombstone and logs the view once', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Kept')
    await createDeck(ada._id, project._id, 'Lecture', 'del-user-1')
    await deleteUserCascade(ada._id.toString())

    const res = await get(`/api/admin/users/${ada._id}`, token)
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('ada@example.com')
    expect(typeof res.body.deletedAt).toBe('string')
    // Counts include the content tombstoned with the account, matching the
    // rows the page lists below them.
    expect(res.body.projectCount).toBe(1)
    expect(res.body.deckCount).toBe(1)

    const entries = await auditLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('user.deleted_view')
    expect(entries[0]!.targetType).toBe('user')
    expect(entries[0]!.targetId).toBe(ada._id.toString())
    expect(entries[0]!.details).toMatchObject({ email: 'ada@example.com' })
  })

  it('logs one entry per opening, not per request to its sub-lists', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Kept')
    await createDeck(ada._id, project._id, 'Lecture', 'del-user-2')
    await deleteUserCascade(ada._id.toString())

    // The page loads all three together; only the detail read is an
    // "opening", so the log must not gain three entries per visit.
    await Promise.all([
      get(`/api/admin/users/${ada._id}`, token),
      get(`/api/admin/users/${ada._id}/projects`, token),
      get(`/api/admin/users/${ada._id}/decks`, token),
    ])
    expect(await auditLog()).toHaveLength(1)

    // A second visit is a second access, so it is recorded again.
    await get(`/api/admin/users/${ada._id}`, token)
    expect(await auditLog()).toHaveLength(2)
  })

  it('lists the account’s tombstoned projects and lectures', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Kept')
    const deck = await createDeck(ada._id, project._id, 'Lecture', 'del-user-3')
    await deleteUserCascade(ada._id.toString())

    const projects = await get(`/api/admin/users/${ada._id}/projects`, token)
    expect(projects.body.projects).toHaveLength(1)
    expect(projects.body.projects[0].id).toBe(project._id.toString())
    expect(typeof projects.body.projects[0].deletedAt).toBe('string')

    const decks = await get(`/api/admin/users/${ada._id}/decks`, token)
    expect(decks.body.decks).toHaveLength(1)
    expect(decks.body.decks[0].id).toBe(deck._id.toString())
    expect(typeof decks.body.decks[0].deletedAt).toBe('string')
  })

  it('logs nothing when the account is live', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')

    const res = await get(`/api/admin/users/${ada._id}`, token)
    expect(res.status).toBe(200)
    expect(res.body.deletedAt).toBeUndefined()
    expect(await auditLog()).toHaveLength(0)
  })

  it('404s for an id that never existed', async () => {
    const token = await asAdmin()
    const res = await get('/api/admin/users/507f1f77bcf86cd799439011', token)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/admin/projects/:id on a soft-deleted project', () => {
  it('returns the project with its tombstone and lectures, and logs the view', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Gone')
    const deck = await createDeck(ada._id, project._id, 'Lecture', 'del-proj-1')
    await deleteProjectCascade(project._id)

    const res = await get(`/api/admin/projects/${project._id}`, token)
    expect(res.status).toBe(200)
    expect(res.body.project.title).toBe('Gone')
    expect(typeof res.body.deletedAt).toBe('string')
    expect(res.body.owner.email).toBe('ada@example.com')
    expect(res.body.owner.deletedAt).toBeUndefined()
    // The lectures that went down with it are listed, each badged.
    expect(res.body.decks).toHaveLength(1)
    expect(res.body.decks[0].id).toBe(deck._id.toString())
    expect(typeof res.body.decks[0].deletedAt).toBe('string')

    const entries = await auditLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('project.deleted_view')
    expect(entries[0]!.details).toMatchObject({ title: 'Gone' })
  })

  it('opens a project whose owner was deleted too, flagging the owner', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Owner gone')
    await deleteUserCascade(ada._id.toString())

    const res = await get(`/api/admin/projects/${project._id}`, token)
    // A tombstoned owner used to make this 404 — an admin must still be
    // able to open the content of a deleted account.
    expect(res.status).toBe(200)
    expect(res.body.owner.email).toBe('ada@example.com')
    expect(typeof res.body.owner.deletedAt).toBe('string')
  })

  it('logs nothing when the project is live', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Live')

    const res = await get(`/api/admin/projects/${project._id}`, token)
    expect(res.body.deletedAt).toBeUndefined()
    expect(await auditLog()).toHaveLength(0)
  })
})

describe('GET /api/admin/decks/:id on a soft-deleted lecture', () => {
  it('returns the lecture, its seed material, and logs the view', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Course', {
      seedContext: 'Project notes',
    })
    const deck = await createDeck(ada._id, project._id, 'Week 1', 'del-deck-1')
    await SeedAssetModel.create({
      projectId: project._id,
      deckId: deck._id,
      type: 'pdf',
      name: 'reading.pdf',
      status: 'ready',
      keywords: [],
      enabled: true,
    })
    await deleteDeckCascade(deck)

    const res = await get(`/api/admin/decks/${deck._id}`, token)
    expect(res.status).toBe(200)
    expect(typeof res.body.deck.deletedAt).toBe('string')
    expect(res.body.project.title).toBe('Course')
    expect(res.body.project.deletedAt).toBeUndefined()
    // Seed material tombstoned with the lecture is still returned, badged,
    // so an admin can see what fed its generation.
    expect(res.body.seed.lecture.assets).toHaveLength(1)
    expect(typeof res.body.seed.lecture.assets[0].deletedAt).toBe('string')
    expect(res.body.seed.project.notes).toBe('Project notes')

    const entries = await auditLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('deck.deleted_view')
    expect(entries[0]!.details).toMatchObject({ title: 'Week 1' })
  })

  it('resolves inherited visibility through a project deleted with it', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Public course', {
      visibility: 'public',
    })
    const deck = await createDeck(ada._id, project._id, 'Week 1', 'del-deck-2')
    await deleteProjectCascade(project._id)

    const res = await get(`/api/admin/decks/${deck._id}`, token)
    expect(res.status).toBe(200)
    // Without tombstone-aware ACL loading the project reads as dangling
    // and the lecture would wrongly report `restricted`.
    expect(res.body.deck.visibility).toBe('public')
    expect(typeof res.body.project.deletedAt).toBe('string')
  })

  it('surfaces seed material the owner removed from a live lecture', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Course')
    const deck = await createDeck(ada._id, project._id, 'Week 1', 'del-deck-3')
    await SeedAssetModel.create({
      projectId: project._id,
      deckId: deck._id,
      type: 'pdf',
      name: 'withdrawn.pdf',
      status: 'ready',
      keywords: [],
      enabled: true,
      deletedAt: new Date(),
    })

    const res = await get(`/api/admin/decks/${deck._id}`, token)
    expect(res.body.deck.deletedAt).toBeUndefined()
    expect(res.body.seed.lecture.assets).toHaveLength(1)
    expect(res.body.seed.lecture.assets[0].name).toBe('withdrawn.pdf')
    expect(typeof res.body.seed.lecture.assets[0].deletedAt).toBe('string')
    // Opening a live lecture is not an access to deleted content, so the
    // badged asset alone does not earn an audit entry.
    expect(await auditLog()).toHaveLength(0)
  })
})

describe('moderation still refuses a soft-deleted target', () => {
  it('404s deleting, banning, or resetting the password of a deleted account', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    await deleteUserCascade(ada._id.toString())
    const auth = `Bearer ${token}`

    const [del, ban, password] = await Promise.all([
      request(server)
        .delete(`/api/admin/users/${ada._id}`)
        .set('Authorization', auth),
      request(server)
        .post(`/api/admin/users/${ada._id}/ban`)
        .set('Authorization', auth)
        .send({}),
      request(server)
        .post(`/api/admin/users/${ada._id}/password`)
        .set('Authorization', auth)
        .send({ password: 'sturdy-passw0rd' }),
    ])
    expect(del.status).toBe(404)
    expect(ban.status).toBe(404)
    expect(password.status).toBe(404)
  })

  it('404s deleting an already-deleted project or lecture', async () => {
    const token = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(ada._id, 'Gone')
    const deck = await createDeck(ada._id, project._id, 'Gone too', 'del-mod-1')
    await deleteProjectCascade(project._id)
    const auth = `Bearer ${token}`

    const [proj, lecture] = await Promise.all([
      request(server)
        .delete(`/api/admin/projects/${project._id}`)
        .set('Authorization', auth),
      request(server)
        .delete(`/api/admin/decks/${deck._id}`)
        .set('Authorization', auth),
    ])
    expect(proj.status).toBe(404)
    expect(lecture.status).toBe(404)
  })
})
