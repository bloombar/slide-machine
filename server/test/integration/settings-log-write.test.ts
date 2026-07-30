/**
 * Integration tests for what reaches the settings change log, against a
 * real MongoDB. The log is meant to answer "how did these settings get
 * this way", so the coverage here walks every settings surface — account,
 * project, and lecture — through the real actions and endpoints and
 * checks that each edit lands as one entry with the right actor, role,
 * owner, and before/after.
 *
 * The admin action log is asserted alongside where the two overlap: an
 * admin's settings edit belongs in both, an owner's in only this one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Every settings entry written so far, oldest first. */
const settingsEntries = () =>
  SettingsChangeLogModel.find().sort({ createdAt: 1 })

/** The single settings entry expected by a test, or a clear failure. */
const onlyEntry = async () => {
  const entries = await settingsEntries()
  expect(entries).toHaveLength(1)
  return entries[0]!
}

let ada: string
let adaId: string
let admin: string
let bob: string
let bobId: string
let projectId: string
let deckId: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SettingsChangeLogModel.init(),
  ])
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
    RefreshTokenModel.deleteMany({}),
    AdminActionLogModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  admin = await registerUser(ADMIN_EMAIL)
  bob = await registerUser('bob@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  bobId = (await UserModel.findOne({
    email: 'bob@example.com',
  }))!._id.toString()
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', { projectId, title: 'Waves' })
  deckId = deck.body.id as string
  // Only the settings edits each test makes should appear in the log
  await SettingsChangeLogModel.deleteMany({})
})

describe('account settings', () => {
  it('records the profile visibility a user changes about themselves', async () => {
    const res = await act(ada, 'user.setProfileVisibility', {
      profileVisibility: 'private',
    })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorId.toString()).toBe(adaId)
    expect(entry.actorEmail).toBe('ada@example.com')
    expect(entry.actorRole).toBe('owner')
    expect(entry.entityType).toBe('user')
    expect(entry.entityId).toBe(adaId)
    expect(entry.entityName).toBe('ada@example.com')
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({
      profileVisibility: { from: 'public', to: 'private' },
    })
    // Nothing an admin did, so nothing in the admin audit log
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('records the lecturing language, and clearing it back to the default', async () => {
    await act(ada, 'user.setLanguage', { language: 'fr' })
    await act(ada, 'user.setLanguage', { language: null })

    const entries = await settingsEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.changes).toEqual({ language: { from: null, to: 'fr' } })
    expect(entries[1]?.changes).toEqual({ language: { from: 'fr', to: null } })
  })

  it('writes nothing when a user re-saves the value already stored', async () => {
    const res = await act(ada, 'user.setProfileVisibility', {
      profileVisibility: 'public',
    })
    expect(res.status).toBe(200)
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })

  it("records an admin editing someone's account, in both logs", async () => {
    const res = await request(server)
      .patch(`/api/admin/users/${adaId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ displayName: 'Ada L', locale: 'fr' })
    expect(res.status).toBe(204)

    const entry = await onlyEntry()
    expect(entry.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry.actorRole).toBe('admin')
    // Filed under the account whose settings changed, not the admin
    expect(entry.entityId).toBe(adaId)
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({
      displayName: { from: 'ada', to: 'Ada L' },
      locale: { from: 'en', to: 'fr' },
    })
    expect(await AdminActionLogModel.countDocuments()).toBe(1)
  })

  it('writes nothing when an admin patch changes nothing', async () => {
    const res = await request(server)
      .patch(`/api/admin/users/${adaId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ displayName: 'ada' })
    expect(res.status).toBe(204)
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })
})

describe('project settings', () => {
  it("records an owner's own edit, which the admin log ignores", async () => {
    const res = await act(ada, 'project.update', {
      projectId,
      generationFreedom: 5,
      language: 'fr',
    })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorId.toString()).toBe(adaId)
    expect(entry.actorEmail).toBe('ada@example.com')
    expect(entry.actorRole).toBe('owner')
    expect(entry.entityType).toBe('project')
    expect(entry.entityId).toBe(projectId)
    expect(entry.entityName).toBe('Physics')
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({
      generationFreedom: { from: null, to: 5 },
      language: { from: null, to: 'fr' },
    })
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('records a collaborator with edit access as an editor', async () => {
    await act(ada, 'project.share', {
      projectId,
      email: 'bob@example.com',
      role: 'editor',
    })
    await SettingsChangeLogModel.deleteMany({})

    const res = await act(bob, 'project.update', { projectId, language: 'es' })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorId.toString()).toBe(bobId)
    expect(entry.actorRole).toBe('editor')
    // The entry belongs to the owner's settings, not the editor's
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({ language: { from: null, to: 'es' } })
  })

  it('records sharing and unsharing from the Privacy & Sharing tab', async () => {
    await act(ada, 'project.share', {
      projectId,
      email: 'bob@example.com',
      role: 'viewer',
    })
    await act(ada, 'project.unshare', {
      projectId,
      userId: bobId,
      role: 'viewer',
    })

    const entries = await settingsEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.changes).toEqual({ viewers: { from: '', to: bobId } })
    expect(entries[1]?.changes).toEqual({ viewers: { from: bobId, to: '' } })
  })

  it('records an ownership transfer under the new owner', async () => {
    const res = await act(ada, 'project.transferOwnership', {
      projectId,
      userId: bobId,
    })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorId.toString()).toBe(adaId)
    expect(entry.actorRole).toBe('owner')
    // The history follows the settings to whoever holds them now
    expect(entry.ownerId).toBe(bobId)
    expect(entry.changes).toMatchObject({
      ownerId: { from: adaId, to: bobId },
      editors: { from: '', to: adaId },
    })
  })

  it("records an admin's override edit in both logs", async () => {
    const res = await act(admin, 'project.switchTemplate', {
      projectId,
      templateId: 'midnight',
    })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry.actorRole).toBe('admin')
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({
      templateId: { from: 'classic', to: 'midnight' },
    })
    expect(await AdminActionLogModel.countDocuments()).toBe(1)
  })

  it('writes nothing for a re-saved value, a refused edit, or a plain read', async () => {
    await act(ada, 'project.update', { projectId, title: 'Physics' })
    // A stranger with no access at all
    const refused = await act(bob, 'project.update', {
      projectId,
      language: 'es',
    })
    expect(refused.status).toBe(403)
    // Opening the sharing tab reads through the same wrapper as an edit
    const read = await act(ada, 'project.shares', { projectId })
    expect(read.status).toBe(200)

    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })
})

describe('lecture settings', () => {
  it("records an owner's generation setting", async () => {
    const res = await act(ada, 'deck.setLanguage', { deckId, language: 'es' })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorRole).toBe('owner')
    expect(entry.entityType).toBe('deck')
    expect(entry.entityId).toBe(deckId)
    expect(entry.entityName).toBe('Waves')
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({ language: { from: null, to: 'es' } })
  })

  it('records the refine settings field by field', async () => {
    const res = await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      slidesLevel: 4,
    })
    expect(res.status).toBe(200)

    expect((await onlyEntry()).changes).toEqual({
      refineSlidesEnabled: { from: null, to: false },
      refineSlidesLevel: { from: null, to: 4 },
    })
  })

  it('records detaching a lecture from its project, and re-attaching it', async () => {
    // Pinning the visibility it already inherits is still a real change:
    // the lecture stops following its project.
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    await act(ada, 'deck.resetAccess', { deckId })

    const entries = await settingsEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.changes).toMatchObject({
      accessInherited: { from: true, to: false },
    })
    expect(entries[1]?.changes).toMatchObject({
      accessInherited: { from: false, to: true },
    })
  })

  it('records a rename and an ownership transfer', async () => {
    await act(ada, 'deck.rename', { deckId, title: 'Sound waves' })
    await act(ada, 'deck.transferOwnership', { deckId, userId: bobId })

    const entries = await settingsEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.changes).toEqual({
      title: { from: 'Waves', to: 'Sound waves' },
    })
    expect(entries[1]?.ownerId).toBe(bobId)
    expect(entries[1]?.changes).toMatchObject({
      ownerId: { from: adaId, to: bobId },
    })
  })

  it("records an admin's override edit in both logs", async () => {
    const res = await act(admin, 'deck.setGenerationFreedom', {
      deckId,
      freedom: 5,
    })
    expect(res.status).toBe(200)

    const entry = await onlyEntry()
    expect(entry.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry.actorRole).toBe('admin')
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes).toEqual({ generationFreedom: { from: null, to: 5 } })
    expect(await AdminActionLogModel.countDocuments()).toBe(1)
  })

  it('leaves content edits out: they are not settings', async () => {
    const res = await act(ada, 'slide.add', { deckId })
    expect(res.status).toBe(200)
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })
})
