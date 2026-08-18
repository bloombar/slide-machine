/**
 * Integration tests for the lecture study label (EVAL-3), against a real
 * MongoDB. The label is the one lecture setting gated on the admin
 * allowlist on BOTH sides of the ACL: a non-admin owner or editor is
 * refused, an admin edits their own lecture as its owner, and an admin
 * labels another user's lecture on the audited override (ADMIN-5).
 *
 * The wire shape is covered too: the shared deck DTO must not carry the
 * label — it can name a study condition — while the owner and any
 * allowlisted admin still read it back from the view route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

const ADMIN_EMAIL = 'admin@example.com'
const SECOND_ADMIN_EMAIL = 'admin2@example.com'
const LABEL = 'B1-SWE-treatment'

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

const viewDeck = (token: string, slug: string) =>
  request(server)
    .get(`/api/decks/${slug}`)
    .set('Authorization', `Bearer ${token}`)

let ada: string
let admin: string
let admin2: string
let bob: string
let projectId: string
let deckId: string
let deckSlug: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = `${ADMIN_EMAIL},${SECOND_ADMIN_EMAIL}`
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
    RefreshTokenModel.deleteMany({}),
    AdminActionLogModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  admin = await registerUser(ADMIN_EMAIL)
  admin2 = await registerUser(SECOND_ADMIN_EMAIL)
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', { projectId, title: 'Waves' })
  deckId = deck.body.id as string
  deckSlug = deck.body.permalinkSlug as string
  // Only the settings edits each test makes should appear in the log
  await SettingsChangeLogModel.deleteMany({})
})

describe('deck.setStudyLabel authorization', () => {
  it('refuses the owner when they are not an admin', async () => {
    const res = await act(ada, 'deck.setStudyLabel', {
      deckId,
      studyLabel: LABEL,
    })
    expect(res.status).toBe(403)
    expect((await DeckModel.findById(deckId))!.studyLabel).toBeUndefined()
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })

  it('refuses a non-admin editor', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'bob@example.com',
      role: 'editor',
    })
    const res = await act(bob, 'deck.setStudyLabel', {
      deckId,
      studyLabel: LABEL,
    })
    expect(res.status).toBe(403)
    expect((await DeckModel.findById(deckId))!.studyLabel).toBeUndefined()
  })

  it("lets an admin label their own lecture, logged as the owner's edit", async () => {
    const own = await act(admin, 'project.create', { title: 'Study' })
    const deck = await act(admin, 'deck.create', {
      projectId: own.body.id,
      title: 'Block 1',
    })
    await SettingsChangeLogModel.deleteMany({})

    const res = await act(admin, 'deck.setStudyLabel', {
      deckId: deck.body.id,
      studyLabel: LABEL,
    })
    expect(res.status).toBe(200)
    expect(res.body.studyLabel).toBe(LABEL)

    const entries = await SettingsChangeLogModel.find()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.actorRole).toBe('owner')
    expect(entries[0]!.changes).toEqual({
      studyLabel: { from: null, to: LABEL },
    })
    // Editing your own lecture is not an administrative act
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it("records an admin's label on another user's lecture in both logs", async () => {
    const res = await act(admin, 'deck.setStudyLabel', {
      deckId,
      studyLabel: LABEL,
    })
    expect(res.status).toBe(200)
    expect(res.body.studyLabel).toBe(LABEL)

    const entries = await SettingsChangeLogModel.find()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.actorEmail).toBe(ADMIN_EMAIL)
    expect(entries[0]!.actorRole).toBe('admin')
    expect(entries[0]!.changes).toEqual({
      studyLabel: { from: null, to: LABEL },
    })
    expect(await AdminActionLogModel.countDocuments()).toBe(1)
  })

  it("refuses an admin labeling another admin's lecture", async () => {
    const own = await act(admin2, 'project.create', { title: 'Own' })
    const deck = await act(admin2, 'deck.create', {
      projectId: own.body.id,
      title: 'Own lecture',
    })
    const res = await act(admin, 'deck.setStudyLabel', {
      deckId: deck.body.id,
      studyLabel: LABEL,
    })
    expect(res.status).toBe(403)
  })

  it('clears the label on an empty string', async () => {
    await act(admin, 'deck.setStudyLabel', { deckId, studyLabel: LABEL })
    const res = await act(admin, 'deck.setStudyLabel', {
      deckId,
      studyLabel: '',
    })
    expect(res.status).toBe(200)
    expect(res.body.studyLabel).toBeUndefined()
    expect((await DeckModel.findById(deckId))!.studyLabel).toBeUndefined()

    const entries = await SettingsChangeLogModel.find().sort({ createdAt: 1 })
    expect(entries).toHaveLength(2)
    expect(entries[1]!.changes).toEqual({
      studyLabel: { from: LABEL, to: null },
    })
  })

  it('rejects a label longer than 200 characters', async () => {
    const res = await act(admin, 'deck.setStudyLabel', {
      deckId,
      studyLabel: 'x'.repeat(201),
    })
    expect(res.status).toBe(400)
  })
})

describe('study label on the wire', () => {
  beforeEach(async () => {
    await act(admin, 'deck.setStudyLabel', { deckId, studyLabel: LABEL })
    await act(ada, 'deck.share', {
      deckId,
      email: 'bob@example.com',
      role: 'viewer',
    })
  })

  it('returns the label to the owner', async () => {
    const res = await viewDeck(ada, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.studyLabel).toBe(LABEL)
  })

  it('omits the label from a shared viewer', async () => {
    const res = await viewDeck(bob, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.studyLabel).toBeUndefined()
  })

  it('returns the label to an allowlisted admin', async () => {
    const res = await viewDeck(admin, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.studyLabel).toBe(LABEL)
  })
})
