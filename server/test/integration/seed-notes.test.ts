/**
 * Integration tests for two-layer seed notes (PROJ-1/SEED-1): project
 * and lecture notes save through their actions with the same ownership
 * rules as other edits, and session.phrase hands both layers to the
 * generation provider (deck notes are the more specific layer).
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
let byron: string
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
  byron = await registerUser('byron@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
})

describe('project.update', () => {
  it('saves seed notes and other fields for the owner', async () => {
    const res = await act(ada, 'project.update', {
      projectId,
      seedContext: 'Mechanics syllabus, weeks 1-3',
      course: 'PHYS 101',
    })
    expect(res.status).toBe(200)
    expect(res.body.seedContext).toBe('Mechanics syllabus, weeks 1-3')
    expect(res.body.course).toBe('PHYS 101')
    expect(res.body.title).toBe('Physics')
  })

  it('is owner-only', async () => {
    const res = await act(byron, 'project.update', {
      projectId,
      seedContext: 'not mine',
    })
    expect(res.status).toBe(403)
  })
})

describe('deck.setSeedNotes', () => {
  it('saves lecture notes for the owner and for editors', async () => {
    const owner = await act(ada, 'deck.setSeedNotes', {
      deckId,
      seedContext: 'Standing waves demo',
    })
    expect(owner.status).toBe(200)
    expect(owner.body.seedContext).toBe('Standing waves demo')

    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'editor',
    })
    const editor = await act(byron, 'deck.setSeedNotes', {
      deckId,
      seedContext: 'Standing waves demo, with tuning forks',
    })
    expect(editor.status).toBe(200)
  })

  it('blocks strangers', async () => {
    const res = await act(byron, 'deck.setSeedNotes', {
      deckId,
      seedContext: 'nope',
    })
    expect(res.status).toBe(403)
  })
})

describe('generation freedom resolution', () => {
  it('resolves lecture -> project -> server default, storing nothing until set', async () => {
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      // Nothing set anywhere: the server default (3) applies
      await act(ada, 'session.phrase', { deckId, phrase: 'one two three' })
      expect(seen[0]!.freedom).toBe(3)
      expect(
        (await DeckModel.findById(deckId))!.generationFreedom,
      ).toBeUndefined()

      // Project setting cascades to the inheriting lecture
      await act(ada, 'project.update', { projectId, generationFreedom: 8 })
      await act(ada, 'session.phrase', { deckId, phrase: 'four five six' })
      expect(seen[1]!.freedom).toBe(8)
      expect(
        (await DeckModel.findById(deckId))!.generationFreedom,
      ).toBeUndefined()

      // Lecture override wins
      await act(ada, 'deck.setGenerationFreedom', { deckId, freedom: 1 })
      await act(ada, 'session.phrase', { deckId, phrase: 'seven eight' })
      expect(seen[2]!.freedom).toBe(1)

      // Clearing re-inherits the project's value
      await act(ada, 'deck.setGenerationFreedom', { deckId, freedom: null })
      await act(ada, 'session.phrase', { deckId, phrase: 'nine ten' })
      expect(seen[3]!.freedom).toBe(8)
      expect(
        (await DeckModel.findById(deckId))!.generationFreedom,
      ).toBeUndefined()

      // Clearing the project re-inherits the server default
      await act(ada, 'project.update', { projectId, generationFreedom: null })
      await act(ada, 'session.phrase', { deckId, phrase: 'eleven twelve' })
      expect(seen[4]!.freedom).toBe(3)
    } finally {
      provider.generateSlideContent = original
    }
  })
})

describe('session.phrase seed layers', () => {
  it('passes project and deck notes to the generation provider', async () => {
    await act(ada, 'project.update', {
      projectId,
      seedContext: 'PROJECT-NOTES',
    })
    await act(ada, 'deck.setSeedNotes', { deckId, seedContext: 'DECK-NOTES' })

    // The registry caches instances, so spy on the live provider's method
    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      const res = await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Waves transfer energy without transferring matter',
      })
      expect(res.status).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.seedContext).toEqual({
        project: 'PROJECT-NOTES',
        deck: 'DECK-NOTES',
      })
    } finally {
      provider.generateSlideContent = original
    }
  })
})
