/**
 * Integration test for GENERATION_LAYOUT_REFIT=false: updates never
 * change a slide's layout — no refits are offered to the model, and
 * even a proposed delta layout switch is pinned to the current layout.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import request from 'supertest'

// Same validated env, with the layout-refit flag forced off
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, GENERATION_LAYOUT_REFIT: false },
  }
})

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

describe('session.phrase with GENERATION_LAYOUT_REFIT off', () => {
  it('pins the layout: the refit-triggering phrase merges as a plain delta', async () => {
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a strong protective barrier',
    })
    expect(first.body.slide.layoutType).toBe('content')

    // With the flag on this exact phrase refits to a list (see
    // decks.test.ts); with it off the layout must not move
    const update = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Also it contains cholesterol, embedded proteins, glycolipids',
    })
    expect(update.body.kind).toBe('slide.update')
    expect(update.body.slide.layoutType).toBe('content')
    // Delta semantics: the whole continuation is one appended bullet
    expect(update.body.slide.bullets).toEqual([
      'it contains cholesterol, embedded proteins, glycolipids',
    ])
    // Committed body untouched
    expect(update.body.slide.body).toBe(
      'The cell membrane is a strong protective barrier',
    )
  })
})
