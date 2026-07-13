/**
 * Integration tests for AI lecture titling: an untitled lecture keeps
 * requesting a title with each phrase until the provider commits to
 * one; the first title is saved and rides the SlideEvent; titled
 * lectures never ask and are never overwritten.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { registry } from '../../src/providers/registry'
import type {
  GenerationProvider,
  SlideGenerationRequest,
} from '@slide-machine/shared'
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
let projectId: string
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
  const project = await act(ada, 'project.create', { title: 'Biology' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', { projectId }) // untitled
  deckId = deck.body.id as string
})

describe('AI lecture titling', () => {
  it('keeps asking until the provider commits, then saves once', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      // First phrase: asked, but the mock holds off (no context yet) —
      // the lecture stays untitled and the next phrase asks again
      let res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Photosynthesis basics',
      })
      expect(seen[0]!.suggestDeckTitle).toBe(true)
      expect(res.body.deckTitle).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.title).toBe('')

      // Second phrase: the topic is clear, the title lands and the
      // event carries it for the live header
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Plants convert light into chemical energy',
      })
      expect(seen[1]!.suggestDeckTitle).toBe(true)
      expect(res.body.deckTitle).toBe('Plants Convert Light Into Chemical')
      expect((await DeckModel.findById(deckId))!.title).toBe(
        'Plants Convert Light Into Chemical',
      )

      // Titled now: no more asking, no overwriting
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Chlorophyll absorbs red and blue light',
      })
      expect(seen[2]!.suggestDeckTitle).toBe(false)
      expect(res.body.deckTitle).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.title).toBe(
        'Plants Convert Light Into Chemical',
      )
    } finally {
      provider.generateSlideContent = original
    }
  })

  it('never asks for lectures that already have a title', async () => {
    const titled = await act(ada, 'deck.create', {
      projectId,
      title: 'Named Lecture',
    })
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      await act(ada, 'session.phrase', {
        deckId: titled.body.id,
        phrase: 'Cell membranes are bilayers',
      })
      expect(seen[0]!.suggestDeckTitle).toBe(false)
      expect((await DeckModel.findById(titled.body.id))!.title).toBe(
        'Named Lecture',
      )
    } finally {
      provider.generateSlideContent = original
    }
  })
})
