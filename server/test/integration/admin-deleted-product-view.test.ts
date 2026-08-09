/**
 * Integration tests for the admin bypass over soft-deleted content
 * (ADMIN-6) against a real MongoDB. A tombstoned lecture, project, or
 * account is gone for every other reader (P-10), but an allowlisted admin
 * opens it in the product itself exactly as they open a live one — and
 * every such opening lands in the admin audit log, the way an admin's view
 * of private content does (ADMIN-7 / P-13).
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
import {
  deleteDeckCascade,
  deleteProjectCascade,
  deleteUserCascade,
} from '../../src/lib/cascade'

const ADMIN_EMAIL = 'admin@example.com'

// One long-lived server per file, as the other route suites do: supertest's
// per-request servers intermittently lose requests to port churn on macOS.
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
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const getDeck = (slug: string, token?: string) => {
  const req = request(server).get(`/api/decks/${slug}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

const getProfile = (id: string, token?: string) => {
  const req = request(server).get(`/api/users/${id}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

/** Audit entries of one action, newest last. */
const logged = (action: string) =>
  AdminActionLogModel.find({ action }).sort({ createdAt: 1 })

let admin: string
let ada: string
let byron: string
let adaId: string
let projectId: string
let deckId: string
let slug: string
let slideId: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
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
  ])
  admin = await registerUser(ADMIN_EMAIL)
  ada = await registerUser('ada@example.com')
  byron = await registerUser('byron@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()

  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  const slide = await act(ada, 'slide.add', { deckId })
  slideId = slide.body.id as string
})

describe('the viewer over a soft-deleted lecture', () => {
  beforeEach(async () => {
    await deleteDeckCascade((await DeckModel.findById(deckId))!)
  })

  it('is gone for everyone but an admin', async () => {
    expect((await getDeck(slug)).status).toBe(404)
    expect((await getDeck(slug, byron)).status).toBe(404)
    // Not even its owner: deleting it is what they asked for
    expect((await getDeck(slug, ada)).status).toBe(404)
  })

  it('opens for an admin with the slides it had when it was deleted', async () => {
    const res = await getDeck(slug, admin)
    expect(res.status).toBe(200)
    expect(res.body.deck.title).toBe('Waves')
    expect(res.body.slides.map((s: { id: string }) => s.id)).toEqual([slideId])
    // Read-only: the bypass is a view bypass, never an edit one
    expect(res.body.canEdit).toBe(false)
  })

  it('resolves the inherited visibility instead of falling back to restricted', async () => {
    // The project was tombstoned with the lecture, so an ACL that could not
    // see tombstones would report the dangling-project default.
    await deleteProjectCascade(projectId)
    const res = await getDeck(slug, admin)
    expect(res.status).toBe(200)
    expect(res.body.deck.visibility).toBe('public')
    expect(res.body.owner.displayName).toBe('ada')
  })

  it('still hides a slide the owner had deleted before the lecture', async () => {
    // Restore, drop one slide, add another, then delete the lecture again:
    // the admin should see the lecture as its owner last did.
    await DeckModel.updateOne({ _id: deckId }, { deletedAt: null }).setOptions({
      withDeleted: true,
    })
    await SlideModel.updateOne(
      { _id: slideId },
      { deletedAt: null },
    ).setOptions({ withDeleted: true })
    await act(ada, 'slide.delete', { slideId })
    const kept = await act(ada, 'slide.add', { deckId })
    await deleteDeckCascade((await DeckModel.findById(deckId))!)

    const res = await getDeck(slug, admin)
    expect(res.status).toBe(200)
    expect(res.body.slides.map((s: { id: string }) => s.id)).toEqual([
      kept.body.id,
    ])
  })

  it('records one audit entry per opening, and none for a live lecture', async () => {
    await getDeck(slug, admin)
    await getDeck(slug, admin)
    const entries = await logged('deck.deleted_view')
    expect(entries).toHaveLength(2)
    expect(entries[0]!.actorEmail).toBe(ADMIN_EMAIL)
    expect(entries[0]!.targetType).toBe('deck')
    expect(entries[0]!.targetId).toBe(deckId)
    expect(entries[0]!.details).toMatchObject({ title: 'Waves' })

    // A refused read is not an access, so it is not logged either
    await getDeck(slug, byron)
    expect(await logged('deck.deleted_view')).toHaveLength(2)
  })

  it('logs nothing when the lecture is live', async () => {
    await DeckModel.updateOne({ _id: deckId }, { deletedAt: null }).setOptions({
      withDeleted: true,
    })
    expect((await getDeck(slug, admin)).status).toBe(200)
    expect(await logged('deck.deleted_view')).toHaveLength(0)
  })
})

describe('project.get over a soft-deleted project', () => {
  beforeEach(async () => {
    await deleteProjectCascade(projectId)
  })

  it('is refused to its owner and to a stranger', async () => {
    expect((await act(ada, 'project.get', { projectId })).status).toBe(403)
    expect((await act(byron, 'project.get', { projectId })).status).toBe(403)
  })

  it('opens for an admin and audits the opening', async () => {
    const res = await act(admin, 'project.get', { projectId })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Physics')
    expect(res.body.owner.displayName).toBe('ada')

    const entries = await logged('project.deleted_view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.targetId).toBe(projectId)
    expect(entries[0]!.actorEmail).toBe(ADMIN_EMAIL)
  })

  it('lists the lectures tombstoned with it', async () => {
    const res = await act(admin, 'deck.list', { projectId })
    expect(res.status).toBe(200)
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([deckId])
    // Listing is a sub-read of the page that was already audited
    expect(await logged('deck.deleted_view')).toHaveLength(0)
  })

  it('still refuses the lecture list to a stranger', async () => {
    expect((await act(byron, 'deck.list', { projectId })).status).toBe(403)
  })
})

describe('a lecture deleted before its project', () => {
  it('stays hidden when the project is opened, as a restore would leave it', async () => {
    // The owner throws the lecture away first; the project follows later,
    // so the lecture carries the earlier tombstone. Restoring the project
    // would not bring it back, and neither does viewing the project.
    await act(ada, 'deck.delete', { deckId })
    const kept = await act(ada, 'deck.create', {
      projectId,
      title: 'Survivor',
    })
    await deleteProjectCascade(projectId)

    const res = await act(admin, 'deck.list', { projectId })
    expect(res.status).toBe(200)
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([kept.body.id])
  })
})

describe('the profile of a soft-deleted account', () => {
  beforeEach(async () => {
    await deleteUserCascade(adaId)
  })

  it('is gone for everyone but an admin', async () => {
    expect((await getProfile(adaId)).status).toBe(404)
    expect((await getProfile(adaId, byron)).status).toBe(404)
  })

  it('opens for an admin, showing the work deleted with the account', async () => {
    const res = await getProfile(adaId, admin)
    expect(res.status).toBe(200)
    expect(res.body.user.displayName).toBe('ada')
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.projects[0].project.title).toBe('Physics')
    expect(res.body.projects[0].decks.map((d: { id: string }) => d.id)).toEqual(
      [deckId],
    )
  })

  it('audits each opening', async () => {
    await getProfile(adaId, admin)
    const entries = await logged('user.deleted_view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.targetId).toBe(adaId)
    expect(entries[0]!.details).toMatchObject({ email: 'ada@example.com' })
  })
})
