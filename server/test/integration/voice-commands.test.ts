/**
 * Integration tests for the AI voice-command intent path
 * (GENERATION_VOICE_COMMANDS, mock provider): with the flag on,
 * session.phrase returns command events for recognized phrases and
 * persists nothing; ordinary lecture speech still becomes slides.
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

// Same validated env, with the feature flag forced on for this file
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, GENERATION_VOICE_COMMANDS: true },
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

describe('session.phrase with GENERATION_VOICE_COMMANDS on', () => {
  it('returns a command event and persists nothing', async () => {
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis basics',
    })

    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Please next slide',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kind: 'command', command: 'next' })

    // No slide, no transcript entry — the command left no trace
    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
    expect(view.body.deck.transcript ?? '').not.toContain('Please next slide')
  })

  it('maps each recognized intent to its command id', async () => {
    for (const [phrase, command] of [
      ['Please go back', 'previous'],
      ['Please pause', 'pause'],
      ['Please new slide', 'newSlide'],
    ] as const) {
      const res = await act(ada, 'session.phrase', { deckId, phrase })
      expect(res.body).toEqual({ kind: 'command', command })
    }
  })

  it('still turns ordinary lecture speech into slides', async () => {
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Plants need sunlight, water, carbon dioxide',
    })
    expect(res.body.kind).toBe('slide.new')
    expect(res.body.slide.layoutType).toBe('list')
  })
})
