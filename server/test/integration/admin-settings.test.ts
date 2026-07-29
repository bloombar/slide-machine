/**
 * Integration tests for the admin account settings endpoint (ADMIN-5)
 * against a real MongoDB: the audited PATCH of a user's profile, what it
 * stores, the audit entry it leaves behind, the no-op that writes
 * nothing, the fields it rejects outright, and its refusal to touch an
 * allowlisted account. Project and lecture settings are edited in the
 * owner-facing modal instead — see admin-product-settings.test.ts.
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
import { AdminActionLogModel } from '../../src/models/admin-action-log'
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
  extra: Record<string, unknown> = {},
) =>
  DeckModel.create({
    ownerId,
    projectId,
    title,
    templateId: 'classic',
    permalinkSlug: slug,
    ...extra,
  })

/** A victim with one project holding one lecture that inherits everything. */
const createVictim = async (email = 'victim@example.com') => {
  const { user } = await createUser(email, 'Victim')
  const project = await createProject(user._id, 'Physics')
  const deck = await createDeck(
    user._id,
    project._id,
    'Waves',
    `waves-${user._id}`,
  )
  return { user, project, deck }
}

const patch = (token: string, path: string, body: unknown) =>
  request(server)
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object)

/** Every audit entry written so far, oldest first. */
const auditEntries = () => AdminActionLogModel.find().sort({ createdAt: 1 })

describe('settings gating', () => {
  it('401s anonymous and 403s a non-admin', async () => {
    const { token } = await createUser('user@example.com', 'User')
    const { user } = await createVictim()
    const path = `/api/admin/users/${user._id}`

    const anon = await request(server).patch(path).send({})
    expect(anon.status).toBe(401)
    const forbidden = await patch(token, path, {})
    expect(forbidden.status).toBe(403)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('has no project or lecture settings route of its own', async () => {
    // Those are edited in the owner-facing settings modal instead
    // (ADMIN-5, test/integration/admin-product-settings.test.ts)
    const { token } = await asAdmin()
    const { project, deck } = await createVictim()

    for (const path of [
      `/api/admin/projects/${project._id}`,
      `/api/admin/decks/${deck._id}`,
    ]) {
      const res = await patch(token, path, { visibility: 'public' })
      expect(res.status).toBe(404)
    }
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })
})

describe('PATCH /api/admin/users/:id', () => {
  it('applies every changed field and audits exactly what changed', async () => {
    const { token } = await asAdmin()
    const { user } = await createVictim()
    await UserModel.updateOne({ _id: user._id }, { language: 'fr' })

    const res = await patch(token, `/api/admin/users/${user._id}`, {
      displayName: 'Renamed',
      profileVisibility: 'private',
      // Unchanged: the account already lectures in French
      language: 'fr',
    })
    expect(res.status).toBe(204)

    const saved = await UserModel.findById(user._id)
    expect(saved).toMatchObject({
      displayName: 'Renamed',
      profileVisibility: 'private',
      language: 'fr',
      // Absent from the patch, so untouched
      locale: 'en',
    })

    const logs = await auditEntries()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      action: 'user.settings_update',
      targetType: 'user',
      targetId: user._id.toString(),
    })
    // Only the fields that really changed, each with its before and after
    expect(logs[0]!.details).toEqual({
      email: 'victim@example.com',
      changes: {
        displayName: { from: 'Victim', to: 'Renamed' },
        profileVisibility: { from: 'public', to: 'private' },
      },
    })
  })

  it('clears the lecturing language with an explicit null', async () => {
    const { token } = await asAdmin()
    const { user } = await createVictim()
    await UserModel.updateOne({ _id: user._id }, { language: 'es' })

    const res = await patch(token, `/api/admin/users/${user._id}`, {
      language: null,
    })
    expect(res.status).toBe(204)

    expect((await UserModel.findById(user._id))!.language).toBeUndefined()
    expect((await auditEntries())[0]!.details).toMatchObject({
      changes: { language: { from: 'es', to: null } },
    })
  })

  it('writes nothing for a no-op patch or an empty one', async () => {
    const { token } = await asAdmin()
    const { user } = await createVictim()

    for (const body of [{}, { displayName: 'Victim' }]) {
      const res = await patch(token, `/api/admin/users/${user._id}`, body)
      expect(res.status).toBe(204)
    }
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('rejects fields that are governed elsewhere, storing nothing', async () => {
    const { token } = await asAdmin()
    const { user } = await createVictim()

    for (const body of [
      { planTier: 'pro' },
      { email: 'someone-else@example.com' },
      { passwordHash: 'nope' },
      // A valid field carried alongside a rejected one still fails
      { displayName: 'Renamed', planTier: 'pro' },
      { profileVisibility: 'invisible' },
    ]) {
      const res = await patch(token, `/api/admin/users/${user._id}`, body)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('invalid_input')
    }

    expect(await UserModel.findById(user._id)).toMatchObject({
      displayName: 'Victim',
      email: 'victim@example.com',
      planTier: 'free',
    })
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('refuses to edit an allowlisted account and leaves it untouched', async () => {
    const { admin, token } = await asAdmin()

    const res = await patch(token, `/api/admin/users/${admin._id}`, {
      displayName: 'Renamed',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('target_is_admin')
    expect((await UserModel.findById(admin._id))!.displayName).toBe('Admin')
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('404s unknown and malformed ids', async () => {
    const { token } = await asAdmin()
    for (const id of ['64b000000000000000000000', 'nope']) {
      const res = await patch(token, `/api/admin/users/${id}`, {
        displayName: 'Renamed',
      })
      expect(res.status).toBe(404)
    }
  })
})
