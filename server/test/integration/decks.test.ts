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

const app = createApp()

const registerUser = async (email: string): Promise<string> => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(app)
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
  it('creates a deck with a unique permalink slug and lists it', async () => {
    const created = await act(ada, 'deck.create', {
      projectId,
      title: 'Lecture 1: Cells',
      templateId: 'classic',
    })
    expect(created.status).toBe(200)
    expect(created.body.permalinkSlug).toMatch(/^lecture-1-cells-[0-9a-f]{8}$/)
    expect(created.body.visibility).toBe('private')

    const list = await act(ada, 'deck.list', { projectId })
    expect(list.body).toHaveLength(1)

    const got = await act(ada, 'deck.get', { deckId: created.body.id })
    expect(got.status).toBe(200)
    expect(got.body.template.id).toBe('classic')
    expect(got.body.slides).toEqual([])
  })

  it("rejects deck creation in someone else's project and unknown templates", async () => {
    const bob = await registerUser('bob@example.com')
    const foreign = await act(bob, 'deck.create', {
      projectId,
      title: 'Sneaky',
      templateId: 'classic',
    })
    expect(foreign.status).toBe(403)

    const badTemplate = await act(ada, 'deck.create', {
      projectId,
      title: 'Nope',
      templateId: 'does-not-exist',
    })
    expect(badTemplate.status).toBe(400)
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

  it('serves private decks to their owner only, as 404 to others', async () => {
    const anon = await request(app).get(`/api/decks/${slug}`)
    expect(anon.status).toBe(404)

    const owner = await request(app)
      .get(`/api/decks/${slug}`)
      .set('Authorization', `Bearer ${ada}`)
    expect(owner.status).toBe(200)
    expect(owner.body.slides).toHaveLength(1)
    expect(owner.body.template.id).toBe('classic')
  })

  it('serves public decks anonymously', async () => {
    await DeckModel.updateOne({ permalinkSlug: slug }, { visibility: 'public' })
    const res = await request(app).get(`/api/decks/${slug}`)
    expect(res.status).toBe(200)
    expect(res.body.deck.title).toBe('Shared Lecture')
  })

  it('404s unknown slugs', async () => {
    expect((await request(app).get('/api/decks/nope-12345678')).status).toBe(
      404,
    )
  })
})
