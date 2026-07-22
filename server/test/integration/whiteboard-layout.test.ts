/**
 * Integration test for the required `whiteboard` layout (WB-1): it is a valid
 * layout on every built-in template, and when the current slide is a blank
 * whiteboard canvas a spoken phrase creates a NEW slide rather than folding
 * invisible content into the slot-less whiteboard slide.
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
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('whiteboard layout', () => {
  it('adds a blank whiteboard slide directly via slide.add', async () => {
    const added = await act(ada, 'slide.add', {
      deckId,
      layoutType: 'whiteboard',
    })
    expect(added.status).toBe(200)
    expect(added.body.layoutType).toBe('whiteboard')
    // A blank canvas — none of the placeholder starter text.
    expect(added.body.title).toBeFalsy()
    expect(added.body.body).toBeFalsy()
  })

  it('rejects slide.add with a layout not on the template', async () => {
    const added = await act(ada, 'slide.add', {
      deckId,
      layoutType: 'not-a-layout',
    })
    expect(added.status).toBe(400)
  })

  it('is a switchable layout on the template', async () => {
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a protective barrier',
    })
    const slideId = first.body.slide.id as string

    const switched = await act(ada, 'slide.setLayout', {
      slideId,
      layoutType: 'whiteboard',
    })
    expect(switched.status).toBe(200)
    expect(switched.body.layoutType).toBe('whiteboard')
  })

  it('creates a new slide when speaking over a whiteboard slide', async () => {
    // A first slide, switched to a blank whiteboard canvas.
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a protective barrier',
    })
    const whiteboardId = first.body.slide.id as string
    await act(ada, 'slide.setLayout', {
      slideId: whiteboardId,
      layoutType: 'whiteboard',
    })

    // Speaking now must not fold text into the slot-less whiteboard slide —
    // it becomes a new slide instead.
    const spoken = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
    })
    expect(spoken.body.kind).toBe('slide.new')
    expect(spoken.body.slide.id).not.toBe(whiteboardId)
    expect(spoken.body.slide.layoutType).not.toBe('whiteboard')

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(2)
    // The whiteboard slide is untouched: still a whiteboard, and the new
    // phrase's text did not extend its body.
    const whiteboard = view.body.slides.find(
      (s: { id: string }) => s.id === whiteboardId,
    )
    expect(whiteboard.layoutType).toBe('whiteboard')
    expect(whiteboard.body).toBe('The cell membrane is a protective barrier')
  })
})
