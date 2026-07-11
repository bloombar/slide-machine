/**
 * Integration tests for EDIT-1 actions: partial content edits, delete
 * with reindexing, reorder validation, and ownership enforcement.
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
let deckId: string
let slideIds: string[]

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
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
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'L1',
    templateId: 'classic',
  })
  deckId = deck.body.id
  slideIds = []
  for (const phrase of [
    'Photosynthesis basics',
    'Sunlight, water, carbon dioxide',
    'But why?',
  ]) {
    const event = await act(ada, 'session.phrase', { deckId, phrase })
    slideIds.push(event.body.slide.id)
  }
})

describe('slide.editContent', () => {
  it('updates only the provided fields', async () => {
    const res = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      title: 'Intro to Photosynthesis',
    })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Intro to Photosynthesis')
    expect(res.body.layoutType).toBe('title')

    const bullets = await act(ada, 'slide.editContent', {
      slideId: slideIds[1],
      bullets: ['one', 'two'],
      caption: 'Sources',
    })
    expect(bullets.body.bullets).toEqual(['one', 'two'])
    expect(bullets.body.caption).toBe('Sources')
  })

  it("403s editing another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'slide.editContent', {
      slideId: slideIds[0],
      title: 'Hijack',
    })
    expect(res.status).toBe(403)
  })
})

describe('slide.delete', () => {
  it('removes the slide, updates slideOrder, and reindexes the rest', async () => {
    const res = await act(ada, 'slide.delete', { slideId: slideIds[1] })
    expect(res.status).toBe(200)
    expect(res.body.slideOrder).toEqual([slideIds[0], slideIds[2]])

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(2)
    expect(
      view.body.slides.map((s: { id: string; index: number }) => [
        s.id,
        s.index,
      ]),
    ).toEqual([
      [slideIds[0], 0],
      [slideIds[2], 1],
    ])
  })

  it("403s deleting another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    expect(
      (await act(bob, 'slide.delete', { slideId: slideIds[0] })).status,
    ).toBe(403)
  })
})

describe('deck.reorderSlides', () => {
  it('applies a new order and reindexes slides', async () => {
    const newOrder = [slideIds[2], slideIds[0], slideIds[1]]
    const res = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: newOrder,
    })
    expect(res.status).toBe(200)
    expect(res.body.slideOrder).toEqual(newOrder)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides.map((s: { id: string }) => s.id)).toEqual(newOrder)
  })

  it('rejects orders that are not a permutation of the current slides', async () => {
    const missing = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: [slideIds[0], slideIds[1]],
    })
    expect(missing.status).toBe(400)

    const foreignId = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: [slideIds[0], slideIds[1], 'not-a-real-slide'],
    })
    expect(foreignId.status).toBe(400)
  })
})
