/**
 * Integration tests for the lecture-language cascade: nothing is stored
 * until a level explicitly chooses a language, and session.phrase
 * resolves lecture ?? project ?? speaker profile ?? the browser tag
 * sent with the phrase. The deck view exposes the resolved value (minus
 * the browser fallback, which only the client knows).
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
let slug: string

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
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
})

describe('language cascade', () => {
  it('resolves lecture ?? project ?? profile ?? browser, storing nothing until set', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      // Nothing stored anywhere: the browser tag riding with the
      // phrase is the language; without one, none at all
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'one',
        browserLanguage: 'de-DE',
      })
      expect(seen[0]!.language).toBe('de-DE')
      await act(ada, 'session.phrase', { deckId, phrase: 'two' })
      expect(seen[1]!.language).toBeUndefined()
      expect((await UserModel.findOne())!.language).toBeUndefined()
      expect((await DeckModel.findById(deckId))!.language).toBeUndefined()

      // Profile choice beats the browser tag
      await act(ada, 'user.setLanguage', { language: 'es' })
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'three',
        browserLanguage: 'de-DE',
      })
      expect(seen[2]!.language).toBe('es')

      // Project beats profile; lecture beats project
      await act(ada, 'project.update', { projectId, language: 'ru' })
      await act(ada, 'session.phrase', { deckId, phrase: 'four' })
      expect(seen[3]!.language).toBe('ru')
      expect((await DeckModel.findById(deckId))!.language).toBeUndefined()

      await act(ada, 'deck.setLanguage', { deckId, language: 'fr' })
      await act(ada, 'session.phrase', { deckId, phrase: 'five' })
      expect(seen[4]!.language).toBe('fr')

      // Clearing each level re-inherits the next one down
      await act(ada, 'deck.setLanguage', { deckId, language: null })
      await act(ada, 'session.phrase', { deckId, phrase: 'six' })
      expect(seen[5]!.language).toBe('ru')

      await act(ada, 'project.update', { projectId, language: null })
      await act(ada, 'session.phrase', { deckId, phrase: 'seven' })
      expect(seen[6]!.language).toBe('es')

      await act(ada, 'user.setLanguage', { language: null })
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'eight',
        browserLanguage: 'de-DE',
      })
      expect(seen[7]!.language).toBe('de-DE')
      expect((await UserModel.findOne())!.language).toBeUndefined()
    } finally {
      provider.generateSlideContent = original
    }
  })

  it('exposes the deck and project levels on the view for client-side STT resolution', async () => {
    const view = () =>
      request(server)
        .get(`/api/decks/${slug}`)
        .set('Authorization', `Bearer ${ada}`)

    // Nothing set: both levels absent — the client falls through to the
    // signed-in profile, then the browser
    let body = (await view()).body
    expect(body.projectLanguage).toBeUndefined()
    expect(body.deck.language).toBeUndefined()

    await act(ada, 'project.update', { projectId, language: 'ru' })
    body = (await view()).body
    expect(body.projectLanguage).toBe('ru')
    expect(body.deck.language).toBeUndefined()

    await act(ada, 'deck.setLanguage', { deckId, language: 'fr' })
    body = (await view()).body
    expect(body.deck.language).toBe('fr')
    expect(body.projectLanguage).toBe('ru')
  })

  it('rejects unsupported languages', async () => {
    expect(
      (await act(ada, 'user.setLanguage', { language: 'xx' })).status,
    ).toBe(400)
    expect(
      (await act(ada, 'deck.setLanguage', { deckId, language: 'de' })).status,
    ).toBe(400)
  })
})
