/**
 * Integration tests for the site-wide admin directories against a real
 * MongoDB: GET /api/admin/projects and GET /api/admin/decks — allowlist
 * gating, row shapes (owner email, lecture counts, project titles,
 * effective visibility), pagination, and sorting. The router self-guards,
 * so the test app mounts it exactly as production wiring would.
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

/** Backdates a document's updatedAt so sort order is deterministic. */
const backdateProject = (id: Types.ObjectId, updatedAt: string) =>
  ProjectModel.updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(updatedAt) } },
    { timestamps: false },
  )

const backdateDeck = (id: Types.ObjectId, updatedAt: string) =>
  DeckModel.updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(updatedAt) } },
    { timestamps: false },
  )

describe.each(['/api/admin/projects', '/api/admin/decks'])(
  'GET %s gating and validation',
  path => {
    it('401s without a token', async () => {
      const res = await request(server).get(path)
      expect(res.status).toBe(401)
    })

    it('403s a signed-in non-admin', async () => {
      const { token } = await createUser('user@example.com', 'User')
      const res = await request(server)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
    })

    it('400s on an invalid query', async () => {
      const admin = await asAdmin()
      for (const query of ['sort=sideways', 'page=0', 'limit=251']) {
        const res = await request(server)
          .get(`${path}?${query}`)
          .set('Authorization', `Bearer ${admin}`)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('invalid_input')
        expect(res.body.error.details?.length).toBeGreaterThan(0)
      }
    })
  },
)

describe('GET /api/admin/projects', () => {
  it('lists every project with owner email, visibility, and lecture count', async () => {
    const admin = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const { user: bob } = await createUser('bob@example.com', 'Bob')
    const physics = await createProject(ada._id, 'Physics')
    const secret = await createProject(bob._id, 'Secret', {
      visibility: 'restricted',
    })
    await createDeck(ada._id, physics._id, 'Waves', 'waves-abc123')
    await createDeck(ada._id, physics._id, 'Optics', 'optics-abc123')

    const res = await request(server)
      .get('/api/admin/projects')
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)

    const rows = res.body.projects as Array<{
      id: string
      createdAt: string
      updatedAt: string
    }>
    const physicsRow = rows.find(p => p.id === physics._id.toString())
    expect(physicsRow).toMatchObject({
      ownerId: ada._id.toString(),
      ownerEmail: 'ada@example.com',
      title: 'Physics',
      visibility: 'public',
      deckCount: 2,
    })
    const secretRow = rows.find(p => p.id === secret._id.toString())
    expect(secretRow).toMatchObject({
      ownerEmail: 'bob@example.com',
      visibility: 'restricted',
      deckCount: 0,
    })
    expect(new Date(physicsRow!.createdAt).getTime()).not.toBeNaN()
    expect(new Date(physicsRow!.updatedAt).getTime()).not.toBeNaN()
  })

  it('paginates with disjoint pages and reports the total', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    for (let i = 0; i < 5; i++) {
      await createProject(user._id, `Project ${i}`)
    }

    const first = await request(server)
      .get('/api/admin/projects?page=1&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(first.body.projects).toHaveLength(3)
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 3 })

    const second = await request(server)
      .get('/api/admin/projects?page=2&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(second.body.projects).toHaveLength(2)

    const firstIds = first.body.projects.map((p: { id: string }) => p.id)
    for (const p of second.body.projects) {
      expect(firstIds).not.toContain(p.id)
    }
  })

  it('sorts by title and timestamps, defaulting to last-edited first', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const alpha = await createProject(user._id, 'Alpha')
    const zulu = await createProject(user._id, 'Zulu')
    // Alpha was edited long ago, Zulu recently.
    await backdateProject(alpha._id, '2020-01-01')

    const byDefault = await request(server)
      .get('/api/admin/projects')
      .set('Authorization', `Bearer ${admin}`)
    expect(byDefault.body.projects[0].id).toBe(zulu._id.toString())

    const byUpdatedAsc = await request(server)
      .get('/api/admin/projects?sort=updated:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(byUpdatedAsc.body.projects[0].id).toBe(alpha._id.toString())

    const byTitleAsc = await request(server)
      .get('/api/admin/projects?sort=title:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(
      byTitleAsc.body.projects.map((p: { title: string }) => p.title),
    ).toEqual(['Alpha', 'Zulu'])

    const byTitleDesc = await request(server)
      .get('/api/admin/projects?sort=title:desc')
      .set('Authorization', `Bearer ${admin}`)
    expect(
      byTitleDesc.body.projects.map((p: { title: string }) => p.title),
    ).toEqual(['Zulu', 'Alpha'])

    // createdAt is immutable under mongoose timestamps; backdating a
    // fixture needs both escape hatches
    await ProjectModel.updateOne(
      { _id: zulu._id },
      { $set: { createdAt: new Date('2019-01-01') } },
      { timestamps: false, overwriteImmutable: true },
    )
    const byCreatedAsc = await request(server)
      .get('/api/admin/projects?sort=created:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(byCreatedAsc.body.projects[0].id).toBe(zulu._id.toString())
  })

  it('sorts by owner email, visibility, and lecture count', async () => {
    const admin = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const { user: zoe } = await createUser('zoe@example.com', 'Zoe')
    // Ada's project is public with two lectures; Zoe's is restricted with none
    const adas = await createProject(ada._id, 'Alpha')
    const zoes = await createProject(zoe._id, 'Beta', {
      visibility: 'restricted',
    })
    await createDeck(ada._id, adas._id, 'Waves', 'waves-abc')
    await createDeck(ada._id, adas._id, 'Optics', 'optics-abc')

    const order = async (sort: string): Promise<string[]> => {
      const res = await request(server)
        .get(`/api/admin/projects?sort=${sort}`)
        .set('Authorization', `Bearer ${admin}`)
      expect(res.status).toBe(200)
      return res.body.projects.map((p: { id: string }) => p.id)
    }

    const [ada1, zoe1] = [adas._id.toString(), zoes._id.toString()]
    expect(await order('owner:asc')).toEqual([ada1, zoe1])
    expect(await order('owner:desc')).toEqual([zoe1, ada1])
    // 'public' sorts before 'restricted'
    expect(await order('visibility:asc')).toEqual([ada1, zoe1])
    expect(await order('visibility:desc')).toEqual([zoe1, ada1])
    // 0 lectures before 2
    expect(await order('lectures:asc')).toEqual([zoe1, ada1])
    expect(await order('lectures:desc')).toEqual([ada1, zoe1])
  })

  it('keeps a low-cardinality sort stable across pages', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    // Every project shares a visibility, so only the id tiebreak orders them
    for (let i = 0; i < 6; i++) await createProject(user._id, `Project ${i}`)

    const ids = async (page: number): Promise<string[]> => {
      const res = await request(server)
        .get(`/api/admin/projects?sort=visibility:asc&page=${page}&limit=3`)
        .set('Authorization', `Bearer ${admin}`)
      return res.body.projects.map((p: { id: string }) => p.id)
    }
    const [first, second] = [await ids(1), await ids(2)]
    expect(new Set([...first, ...second]).size).toBe(6)
  })
})

describe('GET /api/admin/decks', () => {
  it('lists every lecture with owner email, project title, and effective visibility', async () => {
    const admin = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const { user: bob } = await createUser('bob@example.com', 'Bob')
    const open = await createProject(ada._id, 'Open Course')
    const closed = await createProject(bob._id, 'Closed Course', {
      visibility: 'restricted',
    })
    // Three visibility paths: inherit public, override restricted inside
    // a public project, inherit restricted.
    const inherited = await createDeck(ada._id, open._id, 'Waves', 'waves-abc')
    const overridden = await createDeck(
      ada._id,
      open._id,
      'Drafts',
      'drafts-abc',
      {
        accessOverride: { visibility: 'restricted', viewers: [], editors: [] },
      },
    )
    const closedDeck = await createDeck(
      bob._id,
      closed._id,
      'Hidden',
      'hidden-abc',
    )

    const res = await request(server)
      .get('/api/admin/decks')
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(3)

    const rows = res.body.decks as Array<{ id: string }>
    expect(rows.find(d => d.id === inherited._id.toString())).toMatchObject({
      projectId: open._id.toString(),
      projectTitle: 'Open Course',
      ownerId: ada._id.toString(),
      ownerEmail: 'ada@example.com',
      title: 'Waves',
      permalinkSlug: 'waves-abc',
      visibility: 'public',
      slideCount: 0,
    })
    expect(rows.find(d => d.id === overridden._id.toString())).toMatchObject({
      visibility: 'restricted',
      projectTitle: 'Open Course',
    })
    expect(rows.find(d => d.id === closedDeck._id.toString())).toMatchObject({
      visibility: 'restricted',
      ownerEmail: 'bob@example.com',
      projectTitle: 'Closed Course',
    })
  })

  it('paginates with disjoint pages and reports the total', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(user._id, 'Physics')
    for (let i = 0; i < 5; i++) {
      await createDeck(user._id, project._id, `Deck ${i}`, `deck-${i}-abc`)
    }

    const first = await request(server)
      .get('/api/admin/decks?page=1&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(first.body.decks).toHaveLength(3)
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 3 })

    const second = await request(server)
      .get('/api/admin/decks?page=2&limit=3')
      .set('Authorization', `Bearer ${admin}`)
    expect(second.body.decks).toHaveLength(2)

    const firstIds = first.body.decks.map((d: { id: string }) => d.id)
    for (const d of second.body.decks) {
      expect(firstIds).not.toContain(d.id)
    }
  })

  it('sorts by title and timestamps, defaulting to last-edited first', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const project = await createProject(user._id, 'Physics')
    const alpha = await createDeck(user._id, project._id, 'Alpha', 'alpha-abc')
    const zulu = await createDeck(user._id, project._id, 'Zulu', 'zulu-abc')
    await backdateDeck(alpha._id, '2020-01-01')

    const byDefault = await request(server)
      .get('/api/admin/decks')
      .set('Authorization', `Bearer ${admin}`)
    expect(byDefault.body.decks[0].id).toBe(zulu._id.toString())

    const byUpdatedAsc = await request(server)
      .get('/api/admin/decks?sort=updated:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(byUpdatedAsc.body.decks[0].id).toBe(alpha._id.toString())

    const byTitleAsc = await request(server)
      .get('/api/admin/decks?sort=title:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(
      byTitleAsc.body.decks.map((d: { title: string }) => d.title),
    ).toEqual(['Alpha', 'Zulu'])

    const byTitleDesc = await request(server)
      .get('/api/admin/decks?sort=title:desc')
      .set('Authorization', `Bearer ${admin}`)
    expect(
      byTitleDesc.body.decks.map((d: { title: string }) => d.title),
    ).toEqual(['Zulu', 'Alpha'])
  })

  it('sorts by project title, owner email, and slide count', async () => {
    const admin = await asAdmin()
    const { user: ada } = await createUser('ada@example.com', 'Ada')
    const { user: zoe } = await createUser('zoe@example.com', 'Zoe')
    const alphaProject = await createProject(ada._id, 'Alpha Course')
    const zuluProject = await createProject(zoe._id, 'Zulu Course')
    // Ada's lecture: earlier project and owner, but more slides
    const adas = await createDeck(ada._id, alphaProject._id, 'One', 'one-abc', {
      slideOrder: ['s1', 's2', 's3'],
    })
    const zoes = await createDeck(zoe._id, zuluProject._id, 'Two', 'two-abc')

    const order = async (sort: string): Promise<string[]> => {
      const res = await request(server)
        .get(`/api/admin/decks?sort=${sort}`)
        .set('Authorization', `Bearer ${admin}`)
      expect(res.status).toBe(200)
      return res.body.decks.map((d: { id: string }) => d.id)
    }

    const [adaDeck, zoeDeck] = [adas._id.toString(), zoes._id.toString()]
    expect(await order('project:asc')).toEqual([adaDeck, zoeDeck])
    expect(await order('project:desc')).toEqual([zoeDeck, adaDeck])
    expect(await order('owner:asc')).toEqual([adaDeck, zoeDeck])
    expect(await order('owner:desc')).toEqual([zoeDeck, adaDeck])
    // 0 slides before 3
    expect(await order('slides:asc')).toEqual([zoeDeck, adaDeck])
    expect(await order('slides:desc')).toEqual([adaDeck, zoeDeck])
  })

  it('sorts by effective visibility, override and inherited alike', async () => {
    const admin = await asAdmin()
    const { user } = await createUser('ada@example.com', 'Ada')
    const open = await createProject(user._id, 'Open')
    const closed = await createProject(user._id, 'Closed', {
      visibility: 'restricted',
    })
    // Public only by inheritance; restricted only by override — so a sort
    // on the stored field alone would put these in the wrong order
    const inheritsPublic = await createDeck(
      user._id,
      open._id,
      'Waves',
      'waves-abc',
    )
    const overridesPrivate = await createDeck(
      user._id,
      open._id,
      'Drafts',
      'drafts-abc',
      {
        accessOverride: { visibility: 'restricted', viewers: [], editors: [] },
      },
    )
    const inheritsPrivate = await createDeck(
      user._id,
      closed._id,
      'Hidden',
      'hidden-abc',
    )

    const res = await request(server)
      .get('/api/admin/decks?sort=visibility:asc')
      .set('Authorization', `Bearer ${admin}`)
    expect(res.status).toBe(200)
    const rows = res.body.decks as Array<{ id: string; visibility: string }>
    expect(rows.map(d => d.visibility)).toEqual([
      'public',
      'restricted',
      'restricted',
    ])
    expect(rows[0]!.id).toBe(inheritsPublic._id.toString())
    expect(
      rows
        .slice(1)
        .map(d => d.id)
        .sort(),
    ).toEqual(
      [overridesPrivate._id.toString(), inheritsPrivate._id.toString()].sort(),
    )
  })
})
