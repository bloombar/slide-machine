/**
 * Integration tests for templates, decks, the session.phrase pipeline
 * (mock provider), and the public permalink viewer route.
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

// One long-lived server per file: supertest's default per-request
// ephemeral servers intermittently lost requests to localhost port
// churn on macOS (bare 404s with no Express headers)
const server = createApp().listen(0)
afterAll(() => server.close())

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

let ada: string
let projectId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  projectId = project.body.id
})

describe('template.list', () => {
  it('returns the built-in templates with layout descriptors', async () => {
    const res = await act(ada, 'template.list')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
    expect(res.body[0].layouts.map((l: { type: string }) => l.type)).toContain(
      'two-column',
    )
  })
})

describe('deck.create / deck.list / deck.get', () => {
  it('creates untitled lectures with an empty title and untitled slug', async () => {
    const created = await act(ada, 'deck.create', {
      projectId,
      templateId: 'classic',
    })
    expect(created.status).toBe(200)
    expect(created.body.title).toBe('')
    expect(created.body.permalinkSlug).toMatch(/^untitled-[0-9a-f]{8}$/)

    // Titles can also be cleared later; the UI shows "Untitled lecture"
    const cleared = await act(ada, 'deck.rename', {
      deckId: created.body.id,
      title: '',
    })
    expect(cleared.status).toBe(200)
    expect(cleared.body.title).toBe('')
  })

  it('creates a deck with a unique permalink slug and lists it', async () => {
    const created = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture 1: Cells',
      templateId: 'classic',
    })
    expect(created.status).toBe(200)
    expect(created.body.permalinkSlug).toMatch(/^lecture-1-cells-[0-9a-f]{8}$/)
    expect(created.body.visibility).toBe('public')

    const list = await act(ada, 'deck.list', { projectId })
    expect(list.body).toHaveLength(1)

    const got = await act(ada, 'deck.get', { deckId: created.body.id })
    expect(got.status).toBe(200)
    expect(got.body.template.id).toBe('classic')
    expect(got.body.slides).toEqual([])
  })

  it("rejects deck creation in someone else's project", async () => {
    const bob = await registerUser('bob@example.com')
    const foreign = await act(bob, 'deck.create', {
      projectId,
      title: 'Sneaky',
    })
    expect(foreign.status).toBe(403)
  })

  it("new lectures start from the project's default template", async () => {
    await act(ada, 'project.switchTemplate', {
      projectId,
      templateId: 'midnight',
    })
    const created = await act(ada, 'deck.create', { projectId, title: 'M' })
    expect(created.body.templateId).toBe('midnight')

    // Existing lectures keep their stored template; a later project
    // change never rewrites them
    const before = await act(ada, 'deck.create', { projectId, title: 'Kept' })
    await act(ada, 'project.switchTemplate', {
      projectId,
      templateId: 'seminar',
    })
    const view = await act(ada, 'deck.get', { deckId: before.body.id })
    expect(view.body.deck.templateId).toBe('midnight')

    // Unknown project templates are rejected
    expect(
      (
        await act(ada, 'project.switchTemplate', {
          projectId,
          templateId: 'does-not-exist',
        })
      ).status,
    ).toBe(400)
  })
})

describe('session.phrase', () => {
  let deckId: string

  beforeEach(async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture 1',
      templateId: 'midnight',
    })
    deckId = deck.body.id
  })

  it('creates slides from phrases and maintains slideOrder + transcript', async () => {
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis basics',
    })
    expect(first.body.kind).toBe('slide.new')
    expect(first.body.slide.layoutType).toBe('title')
    expect(first.body.slide.index).toBe(0)

    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Plants need sunlight, water, carbon dioxide',
    })
    expect(second.body.kind).toBe('slide.new')
    expect(second.body.slide.layoutType).toBe('list')
    expect(second.body.slide.index).toBe(1)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.deck.slideOrder).toHaveLength(2)
    expect(view.body.deck.transcript).toContain('Photosynthesis basics')
    expect(view.body.slides.map((s: { index: number }) => s.index)).toEqual([
      0, 1,
    ])
  })

  it('updates the current slide on a continuation phrase (GEN-8)', async () => {
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Plants need sunlight, water, carbon dioxide',
    })
    const update = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Also they need minerals from soil',
    })

    expect(update.body.kind).toBe('slide.update')
    expect(update.body.slide.bullets).toContain('they need minerals from soil')

    // Update mutated the slide in place — no new slide was created
    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
  })

  it("403s phrases against another user's deck", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'session.phrase', {
      deckId,
      phrase: 'Hijack attempt',
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/decks/:slug (viewer)', () => {
  let slug: string
  let deckId: string

  beforeEach(async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Shared Lecture',
      templateId: 'classic',
    })
    slug = deck.body.permalinkSlug
    deckId = deck.body.id
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis basics',
    })
  })

  it('serves restricted decks to their owner only, as 404 to others', async () => {
    await DeckModel.updateOne(
      { permalinkSlug: slug },
      {
        accessOverride: { visibility: 'restricted', viewers: [], editors: [] },
      },
    )
    const anon = await request(server).get(`/api/decks/${slug}`)
    expect(anon.status).toBe(404)

    const owner = await request(server)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${ada}`)
    expect(owner.status).toBe(200)
    expect(owner.body.slides).toHaveLength(1)
    expect(owner.body.template.id).toBe('classic')
  })

  it('serves public decks anonymously', async () => {
    await DeckModel.updateOne(
      { permalinkSlug: slug },
      { accessOverride: { visibility: 'public', viewers: [], editors: [] } },
    )
    const res = await request(server).get(`/api/decks/${slug}`)
    expect(res.status).toBe(200)
    expect(res.body.deck.title).toBe('Shared Lecture')
  })

  it('404s unknown slugs', async () => {
    expect((await request(server).get('/api/decks/nope-12345678')).status).toBe(
      404,
    )
  })
})

describe('deck.list across projects (home screen)', () => {
  it('returns all owned decks ordered by modification date descending', async () => {
    const deckA = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture A',
      templateId: 'classic',
    })
    const deckB = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture B',
      templateId: 'classic',
    })

    // Speaking into A modifies it, moving it ahead of the newer B
    const event = await act(ada, 'session.phrase', {
      deckId: deckA.body.id,
      phrase: 'Photosynthesis basics',
    })
    let list = await act(ada, 'deck.list')
    expect(list.status).toBe(200)
    expect(list.body.map((d: { id: string }) => d.id)).toEqual([
      deckA.body.id,
      deckB.body.id,
    ])

    // Editing a slide touches its deck too
    await act(ada, 'session.phrase', {
      deckId: deckB.body.id,
      phrase: 'Cells overview',
    })
    await act(ada, 'slide.editContent', {
      slideId: event.body.slide.id,
      title: 'Edited',
    })
    list = await act(ada, 'deck.list')
    expect(list.body.map((d: { id: string }) => d.id)).toEqual([
      deckA.body.id,
      deckB.body.id,
    ])
  })
})

describe('deck.delete', () => {
  it('cascades slides and lecture-level seed material, owner-only', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Doomed',
      templateId: 'classic',
    })
    const deckId = deck.body.id as string
    await act(ada, 'slide.add', { deckId })

    // A stranger (even a shared editor) cannot delete
    const byron = await registerUser('byron-delete@example.com')
    expect((await act(byron, 'deck.delete', { deckId })).status).toBe(403)
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron-delete@example.com',
      role: 'editor',
    })
    expect((await act(byron, 'deck.delete', { deckId })).status).toBe(403)

    const res = await act(ada, 'deck.delete', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })

    // Gone everywhere: the deck, its slides, and its permalink
    expect((await act(ada, 'deck.get', { deckId })).status).toBe(403)
    expect(await SlideModel.countDocuments({ deckId })).toBe(0)
    const permalink = await request(server).get(
      `/api/decks/${deck.body.permalinkSlug}`,
    )
    expect(permalink.status).toBe(404)
  })
})

describe('deck.rename', () => {
  it('renames an owned deck and 403s foreign decks', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Old Name',
      templateId: 'classic',
    })

    const renamed = await act(ada, 'deck.rename', {
      deckId: deck.body.id,
      title: 'New Name',
    })
    expect(renamed.status).toBe(200)
    expect(renamed.body.title).toBe('New Name')

    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.body.deck.title).toBe('New Name')

    const bob = await registerUser('bob@example.com')
    const foreign = await act(bob, 'deck.rename', {
      deckId: deck.body.id,
      title: 'Hijacked',
    })
    expect(foreign.status).toBe(403)
  })
})

describe('slide.add', () => {
  it('appends a starter slide at the end of an owned deck', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'L2',
      templateId: 'classic',
    })
    await act(ada, 'session.phrase', {
      deckId: deck.body.id,
      phrase: 'Photosynthesis basics',
    })

    const added = await act(ada, 'slide.add', { deckId: deck.body.id })
    expect(added.status).toBe(200)
    expect(added.body).toMatchObject({
      index: 1,
      layoutType: 'content',
      title: 'New slide',
    })

    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.body.deck.slideOrder).toHaveLength(2)
    expect(view.body.slides[1].id).toBe(added.body.id)
  })

  it("403s adding to another user's deck", async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'L3',
      templateId: 'classic',
    })
    const bob = await registerUser('bob@example.com')
    expect((await act(bob, 'slide.add', { deckId: deck.body.id })).status).toBe(
      403,
    )
  })
})

describe('deck.switchTemplate', () => {
  it('switches an owned deck template; rejects unknown templates and foreign decks', async () => {
    const deck = await act(ada, 'deck.create', {
      projectId,
      title: 'Themed',
      templateId: 'classic',
    })

    const switched = await act(ada, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: 'midnight',
    })
    expect(switched.status).toBe(200)
    expect(switched.body.templateId).toBe('midnight')

    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.body.template.id).toBe('midnight')

    const unknown = await act(ada, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: 'does-not-exist',
    })
    expect(unknown.status).toBe(400)

    const bob = await registerUser('bob@example.com')
    const foreign = await act(bob, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: 'classic',
    })
    expect(foreign.status).toBe(403)
  })
})
