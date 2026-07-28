/**
 * Integration tests for the admin settings endpoints (ADMIN-5) against a
 * real MongoDB: the three audited PATCHes (user, project, lecture), what
 * each one stores, the audit entry each leaves behind, the no-op that
 * writes nothing, the fields that are rejected outright, and the refusal
 * to touch anything an allowlisted account owns.
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
  it('401s anonymous and 403s a non-admin on every settings route', async () => {
    const { token } = await createUser('user@example.com', 'User')
    const { user, project, deck } = await createVictim()

    for (const path of [
      `/api/admin/users/${user._id}`,
      `/api/admin/projects/${project._id}`,
      `/api/admin/decks/${deck._id}`,
    ]) {
      const anon = await request(server).patch(path).send({})
      expect(anon.status).toBe(401)
      const forbidden = await patch(token, path, {})
      expect(forbidden.status).toBe(403)
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

describe('PATCH /api/admin/projects/:id', () => {
  it('applies the settings and audits them with the project context', async () => {
    const { token } = await asAdmin()
    const { user, project } = await createVictim()

    const res = await patch(token, `/api/admin/projects/${project._id}`, {
      visibility: 'restricted',
      generationFreedom: 5,
      language: 'fr',
      ttsVoice: 'emma',
    })
    expect(res.status).toBe(204)

    expect(await ProjectModel.findById(project._id)).toMatchObject({
      visibility: 'restricted',
      generationFreedom: 5,
      language: 'fr',
      ttsVoice: 'emma',
    })
    const logs = await auditEntries()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      action: 'project.settings_update',
      targetType: 'project',
      targetId: project._id.toString(),
    })
    expect(logs[0]!.details).toEqual({
      title: 'Physics',
      ownerId: user._id.toString(),
      changes: {
        visibility: { from: 'public', to: 'restricted' },
        generationFreedom: { from: null, to: 5 },
        language: { from: null, to: 'fr' },
        ttsVoice: { from: null, to: 'emma' },
      },
    })
  })

  it('clears AI freedom back to the server default with null', async () => {
    const { token } = await asAdmin()
    const { user } = await createVictim()
    const project = await createProject(user._id, 'Chemistry', {
      generationFreedom: 4,
    })

    const res = await patch(token, `/api/admin/projects/${project._id}`, {
      generationFreedom: null,
    })
    expect(res.status).toBe(204)
    expect(
      (await ProjectModel.findById(project._id))!.generationFreedom,
    ).toBeUndefined()
  })

  it('refuses a project owned by an allowlisted account', async () => {
    const { admin, token } = await asAdmin()
    const project = await createProject(admin._id, "Admin's own")

    const res = await patch(token, `/api/admin/projects/${project._id}`, {
      visibility: 'restricted',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('target_is_admin')
    expect((await ProjectModel.findById(project._id))!.visibility).toBe(
      'public',
    )
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('404s unknown and malformed ids', async () => {
    const { token } = await asAdmin()
    for (const id of ['64b000000000000000000000', 'nope']) {
      const res = await patch(token, `/api/admin/projects/${id}`, {
        visibility: 'public',
      })
      expect(res.status).toBe(404)
    }
  })
})

describe('PATCH /api/admin/decks/:id', () => {
  it('detaches an inheriting lecture, snapshotting the project ACL', async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')
    const project = await createProject(user._id, 'Physics', {
      viewers: ['viewer-1'],
      editors: ['editor-1'],
    })
    const deck = await createDeck(user._id, project._id, 'Waves', 'waves-1')

    const res = await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: 'restricted',
    })
    expect(res.status).toBe(204)

    const saved = await DeckModel.findById(deck._id)
    expect(saved!.accessOverride).toMatchObject({
      visibility: 'restricted',
      viewers: ['viewer-1'],
      editors: ['editor-1'],
    })

    // A later project change no longer reaches the lecture
    await ProjectModel.updateOne(
      { _id: project._id },
      { viewers: ['viewer-2'] },
    )
    expect(
      (await DeckModel.findById(deck._id))!.accessOverride!.viewers,
    ).toEqual(['viewer-1'])

    expect((await auditEntries())[0]!.details).toMatchObject({
      title: 'Waves',
      ownerId: user._id.toString(),
      changes: {
        visibility: { from: 'public', to: 'restricted' },
        accessInherited: { from: true, to: false },
      },
    })
  })

  it('counts pinning the inherited visibility as a real change', async () => {
    const { token } = await asAdmin()
    const { project, deck } = await createVictim()
    expect(project.visibility).toBe('public')

    // Same effective value — but the lecture stops following its project
    const res = await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: 'public',
    })
    expect(res.status).toBe(204)

    expect((await DeckModel.findById(deck._id))!.accessOverride).toMatchObject({
      visibility: 'public',
    })
    const logs = await auditEntries()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.details).toMatchObject({
      changes: { accessInherited: { from: true, to: false } },
    })
    // Visibility itself did not move, so it is not in the record
    expect(
      (logs[0]!.details as { changes: Record<string, unknown> }).changes,
    ).not.toHaveProperty('visibility')
  })

  it("keeps an existing override's people lists when visibility changes", async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')
    const project = await createProject(user._id, 'Physics')
    const deck = await createDeck(user._id, project._id, 'Waves', 'waves-2', {
      accessOverride: {
        visibility: 'public',
        viewers: ['viewer-9'],
        editors: ['editor-9'],
      },
    })

    const res = await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: 'restricted',
    })
    expect(res.status).toBe(204)
    expect((await DeckModel.findById(deck._id))!.accessOverride).toMatchObject({
      visibility: 'restricted',
      viewers: ['viewer-9'],
      editors: ['editor-9'],
    })
  })

  it('drops the override with null so the lecture inherits again', async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')
    const project = await createProject(user._id, 'Physics', {
      visibility: 'restricted',
    })
    const deck = await createDeck(user._id, project._id, 'Waves', 'waves-3', {
      accessOverride: { visibility: 'public', viewers: [], editors: [] },
    })

    const res = await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: null,
    })
    expect(res.status).toBe(204)

    expect((await DeckModel.findById(deck._id))!.accessOverride).toBeUndefined()
    expect((await auditEntries())[0]!.details).toMatchObject({
      changes: {
        // It now reads its project's restricted visibility again
        visibility: { from: 'public', to: 'restricted' },
        accessInherited: { from: false, to: true },
      },
    })
  })

  it('sets and clears the refine settings', async () => {
    const { token } = await asAdmin()
    const { deck } = await createVictim()

    const set = await patch(token, `/api/admin/decks/${deck._id}`, {
      refineIdentifySpeakers: true,
      refineSlidesEnabled: false,
      refineSlidesLevel: 4,
      refineTranscriptEnabled: true,
      refineTranscriptLevel: 1,
    })
    expect(set.status).toBe(204)
    expect(await DeckModel.findById(deck._id)).toMatchObject({
      refineIdentifySpeakers: true,
      refineSlidesEnabled: false,
      refineSlidesLevel: 4,
      refineTranscriptEnabled: true,
      refineTranscriptLevel: 1,
    })

    const clear = await patch(token, `/api/admin/decks/${deck._id}`, {
      refineSlidesEnabled: null,
      refineSlidesLevel: null,
    })
    expect(clear.status).toBe(204)
    const saved = await DeckModel.findById(deck._id)
    expect(saved!.refineSlidesEnabled).toBeUndefined()
    expect(saved!.refineSlidesLevel).toBeUndefined()
    // Untouched settings survive
    expect(saved!.refineTranscriptLevel).toBe(1)
    expect(await AdminActionLogModel.countDocuments()).toBe(2)
  })

  it('rejects unknown fields and out-of-range levels', async () => {
    const { token } = await asAdmin()
    const { deck } = await createVictim()

    for (const body of [
      { title: 'Renamed' },
      { seedContext: 'secret prep notes' },
      { generationFreedom: 9 },
      { ttsVoice: 'not-a-voice' },
    ]) {
      const res = await patch(token, `/api/admin/decks/${deck._id}`, body)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('invalid_input')
    }
    expect((await DeckModel.findById(deck._id))!.title).toBe('Waves')
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('refuses a lecture owned by an allowlisted account', async () => {
    const { admin, token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')
    // The project's owner is ordinary; the LECTURE's owner is the admin
    const project = await createProject(user._id, 'Physics')
    const deck = await createDeck(admin._id, project._id, 'Waves', 'waves-4')

    const res = await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: 'restricted',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('target_is_admin')
    expect((await DeckModel.findById(deck._id))!.accessOverride).toBeUndefined()
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('404s unknown and malformed ids', async () => {
    const { token } = await asAdmin()
    for (const id of ['64b000000000000000000000', 'nope']) {
      const res = await patch(token, `/api/admin/decks/${id}`, {
        visibility: 'public',
      })
      expect(res.status).toBe(404)
    }
  })
})

describe('GET /api/admin/decks/:id settings', () => {
  it('carries the effective settings, inheritance, and project freedom', async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('owner@example.com', 'Owner')
    const project = await createProject(user._id, 'Physics', {
      visibility: 'restricted',
      generationFreedom: 4,
    })
    const deck = await createDeck(user._id, project._id, 'Waves', 'waves-5', {
      language: 'fr',
    })

    const inheriting = await request(server)
      .get(`/api/admin/decks/${deck._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(inheriting.status).toBe(200)
    expect(inheriting.body.settings).toMatchObject({
      visibility: 'restricted',
      accessInherited: true,
      language: 'fr',
      effectiveGenerationFreedom: 4,
    })

    await patch(token, `/api/admin/decks/${deck._id}`, {
      visibility: 'public',
    })
    const pinned = await request(server)
      .get(`/api/admin/decks/${deck._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(pinned.body.settings).toMatchObject({
      visibility: 'public',
      accessInherited: false,
    })
  })
})
