/**
 * Integration tests for the admin moderation endpoints against a real
 * MongoDB: delete user (full cascade), ban email (with register/login
 * enforcement), reset password, delete project, delete lecture — plus
 * the audit-log entry each mutation must leave behind.
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
import { SlideModel } from '../../src/models/slide'
import { SeedAssetModel } from '../../src/models/seed-asset'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefineJobModel } from '../../src/models/refine-job'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { BannedEmailModel } from '../../src/models/banned-email'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import * as authService from '../../src/auth/service'
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
    SlideModel.deleteMany({}),
    SeedAssetModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefineJobModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    BannedEmailModel.deleteMany({}),
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

const createProject = (ownerId: Types.ObjectId, title: string) =>
  ProjectModel.create({ ownerId, title })

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

/** A victim account with one project holding one fully-furnished deck:
 * slides, seed assets at both levels, a transcript segment, a refine
 * job, a retained recording, and an active session. */
const createFurnishedUser = async (email: string) => {
  const { user, token } = await createUser(email, 'Victim')
  const project = await createProject(user._id, 'Doomed project')
  const deck = await createDeck(
    user._id,
    project._id,
    'Doomed',
    `doomed-${user._id}`,
    {
      recordings: [
        {
          sessionId: 's1',
          audioKey: `audio/${user._id}.wav`,
          sampleRate: 16000,
          durationMs: 1000,
        },
      ],
    },
  )
  await Promise.all([
    SlideModel.create({ deckId: deck._id, index: 0, layoutType: 'content' }),
    SeedAssetModel.create({
      projectId: project._id,
      type: 'doc',
      name: 'project-notes.txt',
    }),
    SeedAssetModel.create({
      projectId: project._id,
      deckId: deck._id,
      type: 'image',
      name: 'photo.png',
      storageKey: `seed/${deck._id}.png`,
    }),
    TranscriptSegmentModel.create({ deckId: deck._id, text: 'hello class' }),
    RefineJobModel.create({ deckId: deck._id, status: 'done' }),
    RefreshTokenModel.create({
      userId: user._id,
      tokenHash: `hash-${user._id}`,
      expiresAt: new Date(Date.now() + 60_000),
    }),
  ])
  return { user, token, project, deck }
}

/** Everything the cascade should have removed for a deck. */
const deckRemnants = async (deckId: Types.ObjectId) => ({
  slides: await SlideModel.countDocuments({ deckId }),
  seeds: await SeedAssetModel.countDocuments({ deckId }),
  segments: await TranscriptSegmentModel.countDocuments({ deckId }),
  jobs: await RefineJobModel.countDocuments({ deckId }),
})

describe('moderation gating', () => {
  it('401s without a token and 403s a non-admin', async () => {
    const { user, token } = await createUser('user@example.com', 'User')
    const anon = await request(server).delete(`/api/admin/users/${user._id}`)
    expect(anon.status).toBe(401)

    const forbidden = await request(server)
      .delete(`/api/admin/users/${user._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(forbidden.status).toBe(403)
  })
})

describe('DELETE /api/admin/users/:id', () => {
  it('deletes the account and cascades through all owned data', async () => {
    const { token } = await asAdmin()
    const { user, project, deck } =
      await createFurnishedUser('victim@example.com')
    // The victim also appears in someone else's sharing lists and owns a
    // lecture inside that user's project (post-transfer scenario)
    const { user: friend } = await createUser('friend@example.com', 'Friend')
    const friendProject = await ProjectModel.create({
      ownerId: friend._id,
      title: 'Shared',
      viewers: [user._id.toString()],
      editors: [user._id.toString()],
    })
    const transferred = await createDeck(
      user._id,
      friendProject._id,
      'Transferred',
      `transferred-${user._id}`,
    )

    const res = await request(server)
      .delete(`/api/admin/users/${user._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(204)

    expect(await UserModel.findById(user._id)).toBeNull()
    expect(await ProjectModel.findById(project._id)).toBeNull()
    expect(await DeckModel.findById(deck._id)).toBeNull()
    expect(await DeckModel.findById(transferred._id)).toBeNull()
    expect(await deckRemnants(deck._id)).toEqual({
      slides: 0,
      seeds: 0,
      segments: 0,
      jobs: 0,
    })
    expect(
      await SeedAssetModel.countDocuments({ projectId: project._id }),
    ).toBe(0)
    expect(await RefreshTokenModel.countDocuments({ userId: user._id })).toBe(0)

    // The friend's project survives with the victim scrubbed from its ACLs
    const survivor = await ProjectModel.findById(friendProject._id)
    expect(survivor).not.toBeNull()
    expect(survivor!.viewers).toEqual([])
    expect(survivor!.editors).toEqual([])

    const log = await AdminActionLogModel.findOne({ action: 'user.delete' })
    expect(log).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      targetType: 'user',
      targetId: user._id.toString(),
      details: { email: 'victim@example.com' },
    })
  })

  it('refuses to delete an allowlisted admin', async () => {
    const { admin, token } = await asAdmin()
    const res = await request(server)
      .delete(`/api/admin/users/${admin._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('target_is_admin')
    expect(await UserModel.findById(admin._id)).not.toBeNull()
  })

  it('404s for unknown ids', async () => {
    const { token } = await asAdmin()
    const res = await request(server)
      .delete('/api/admin/users/64b000000000000000000000')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/users/:id/ban', () => {
  it('bans the email, ends sessions, logs, and surfaces in the detail read', async () => {
    const { token } = await asAdmin()
    const { user } = await createFurnishedUser('banned@example.com')

    const res = await request(server)
      .post(`/api/admin/users/${user._id}/ban`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'spam' })
    expect(res.status).toBe(204)

    const ban = await BannedEmailModel.findOne({ email: 'banned@example.com' })
    expect(ban).toMatchObject({ reason: 'spam' })
    expect(await RefreshTokenModel.countDocuments({ userId: user._id })).toBe(0)
    expect(
      await AdminActionLogModel.findOne({ action: 'user.ban_email' }),
    ).toMatchObject({
      targetId: user._id.toString(),
      details: { email: 'banned@example.com', reason: 'spam' },
    })

    const detail = await request(server)
      .get(`/api/admin/users/${user._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(detail.body.banned).toBe(true)

    // Idempotent: a second ban is a 204 no-op, not a duplicate
    const again = await request(server)
      .post(`/api/admin/users/${user._id}/ban`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(again.status).toBe(204)
    expect(
      await BannedEmailModel.countDocuments({ email: 'banned@example.com' }),
    ).toBe(1)
  })

  it('blocks register and login for a banned email', async () => {
    const { token } = await asAdmin()
    await authService.register('banned@example.com', 'password123', 'Banned')
    const user = await UserModel.findOne({ email: 'banned@example.com' })

    await request(server)
      .post(`/api/admin/users/${user!._id}/ban`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    await expect(
      authService.login('banned@example.com', 'password123'),
    ).rejects.toMatchObject({ status: 403, code: 'account_banned' })
    await expect(
      authService.register('banned@example.com', 'password123', 'Again'),
    ).rejects.toMatchObject({ status: 403, code: 'account_banned' })
  })

  it('refuses to ban an allowlisted admin', async () => {
    const { admin, token } = await asAdmin()
    const res = await request(server)
      .post(`/api/admin/users/${admin._id}/ban`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('target_is_admin')
  })
})

describe('POST /api/admin/users/:id/password', () => {
  it('sets the new password, ends sessions, and logs', async () => {
    const { token } = await asAdmin()
    await authService.register('reset@example.com', 'old-password', 'Reset')
    const user = await UserModel.findOne({ email: 'reset@example.com' })
    expect(
      await RefreshTokenModel.countDocuments({ userId: user!._id }),
    ).toBeGreaterThan(0)

    const res = await request(server)
      .post(`/api/admin/users/${user!._id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'new-password' })
    expect(res.status).toBe(204)

    await expect(
      authService.login('reset@example.com', 'old-password'),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    const session = await authService.login('reset@example.com', 'new-password')
    expect(session.user.email).toBe('reset@example.com')
    // Only the sessions from before the reset are gone
    expect(await RefreshTokenModel.countDocuments({ userId: user!._id })).toBe(
      1,
    )
    expect(
      await AdminActionLogModel.findOne({ action: 'user.password_reset' }),
    ).toMatchObject({ targetId: user!._id.toString() })
  })

  it('400s a too-short password', async () => {
    const { token } = await asAdmin()
    const { user } = await createUser('short@example.com', 'Short')
    const res = await request(server)
      .post(`/api/admin/users/${user._id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })
})

describe('DELETE /api/admin/projects/:id and /decks/:id', () => {
  it('deletes a project with everything in it and logs', async () => {
    const { token } = await asAdmin()
    const { user, project, deck } =
      await createFurnishedUser('owner@example.com')

    const res = await request(server)
      .delete(`/api/admin/projects/${project._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(204)

    expect(await ProjectModel.findById(project._id)).toBeNull()
    expect(await DeckModel.findById(deck._id)).toBeNull()
    expect(await deckRemnants(deck._id)).toEqual({
      slides: 0,
      seeds: 0,
      segments: 0,
      jobs: 0,
    })
    // The owner's account is untouched
    expect(await UserModel.findById(user._id)).not.toBeNull()
    expect(
      await AdminActionLogModel.findOne({ action: 'project.delete' }),
    ).toMatchObject({
      targetType: 'project',
      targetId: project._id.toString(),
      details: { title: 'Doomed project', ownerId: user._id.toString() },
    })
  })

  it('deletes a single lecture with everything under it and logs', async () => {
    const { token } = await asAdmin()
    const { user, project, deck } =
      await createFurnishedUser('owner@example.com')
    const keeper = await createDeck(user._id, project._id, 'Keeper', 'keeper-1')

    const res = await request(server)
      .delete(`/api/admin/decks/${deck._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(204)

    expect(await DeckModel.findById(deck._id)).toBeNull()
    expect(await deckRemnants(deck._id)).toEqual({
      slides: 0,
      seeds: 0,
      segments: 0,
      jobs: 0,
    })
    // Siblings and the project survive
    expect(await DeckModel.findById(keeper._id)).not.toBeNull()
    expect(await ProjectModel.findById(project._id)).not.toBeNull()
    expect(
      await AdminActionLogModel.findOne({ action: 'deck.delete' }),
    ).toMatchObject({ targetType: 'deck', targetId: deck._id.toString() })
  })

  it('404s for unknown and malformed ids', async () => {
    const { token } = await asAdmin()
    for (const path of [
      '/api/admin/projects/64b000000000000000000000',
      '/api/admin/projects/nope',
      '/api/admin/decks/64b000000000000000000000',
      '/api/admin/decks/nope',
    ]) {
      const res = await request(server)
        .delete(path)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(404)
    }
  })
})
