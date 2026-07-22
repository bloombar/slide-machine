/**
 * Integration tests for AI lecture titling: an untitled lecture keeps
 * requesting a title with each phrase and REFINES it as the topic broadens,
 * until the user names the lecture by hand (which locks it). A lecture named
 * at creation, or renamed by the user, is never retitled by the AI; clearing
 * the title hands control back to the auto-titler.
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
  it('refines the auto-title each phrase until the user locks it', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      // First phrase: asked, but the mock holds off (no context yet)
      let res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Photosynthesis basics',
      })
      expect(seen[0]!.suggestDeckTitle).toBe(true)
      expect(res.body.deckTitle).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.title).toBe('')

      // Second phrase: the topic is clear, a title lands
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Plants convert light into chemical energy',
      })
      expect(seen[1]!.suggestDeckTitle).toBe(true)
      expect(res.body.deckTitle).toBe('Plants Convert Light Into Chemical')

      // Third phrase: still auto-managed, so the title REFINES rather than
      // freezing at the early guess
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Chlorophyll absorbs red and blue light',
      })
      expect(seen[2]!.suggestDeckTitle).toBe(true)
      expect(res.body.deckTitle).toBe('Chlorophyll Absorbs Red And Blue')
      expect((await DeckModel.findById(deckId))!.title).toBe(
        'Chlorophyll Absorbs Red And Blue',
      )

      // A phrase yielding the same title is a no-op — no redundant re-save
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Chlorophyll absorbs red and blue wavelengths strongly',
      })
      expect(res.body.deckTitle).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.title).toBe(
        'Chlorophyll Absorbs Red And Blue',
      )

      // The user names the lecture: it locks and the AI stops asking
      await act(ada, 'deck.rename', { deckId, title: 'My Photosynthesis Talk' })
      res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Water is split to release oxygen',
      })
      // seen[3] was the redundant phrase; this post-rename call is seen[4]
      expect(seen[4]!.suggestDeckTitle).toBe(false)
      expect(res.body.deckTitle).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.title).toBe(
        'My Photosynthesis Talk',
      )
    } finally {
      provider.generateSlideContent = original
    }
  })

  it('never retitles a lecture the user named at creation', async () => {
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
      await act(ada, 'session.phrase', {
        deckId: titled.body.id,
        phrase: 'Phospholipids form the bilayer core',
      })
      expect(seen.every(r => r.suggestDeckTitle === false)).toBe(true)
      expect((await DeckModel.findById(titled.body.id))!.title).toBe(
        'Named Lecture',
      )
    } finally {
      provider.generateSlideContent = original
    }
  })

  it('re-opens auto-titling when the user clears the title', async () => {
    // Auto-title, then lock by renaming, then clear back to empty
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis basics',
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Plants convert light into chemical energy',
    })
    await act(ada, 'deck.rename', { deckId, title: 'Locked Title' })
    expect((await DeckModel.findById(deckId))!.titleLocked).toBe(true)

    await act(ada, 'deck.rename', { deckId, title: '' })
    const cleared = await DeckModel.findById(deckId)
    expect(cleared!.titleLocked).toBe(false)
    expect(cleared!.title).toBe('')

    // The AI titles it again on the next phrase
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Oxygen is a byproduct of the reaction',
    })
    expect(res.body.deckTitle).toBe('Oxygen Is A Byproduct Of')
  })
})
