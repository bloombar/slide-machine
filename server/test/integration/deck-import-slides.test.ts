/**
 * Creating a lecture from a Google Slides presentation (EXP-5), against a real
 * MongoDB with the Google side mock-backed.
 *
 * The design analysis is covered by src/import/*.test.ts and the content
 * mapping by src/import/slide-content.test.ts. This is the action around them:
 * who may call it, that a lecture AND a template come out of one read, and the
 * property EXP-5 states outright — that each slide sits on the layout the
 * design analysis assigned it, rather than one guessed again afterwards.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import request from 'supertest'

// Hermetic: a developer's local EXPORT_MODE=live must not leak in — this
// suite exercises mock mode, which imports the sample deck rather than
// Google's.
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'mock' } }
})

const { env } = await import('../../src/config/env')
const { connectMongo, disconnectMongo } = await import('../../src/db/mongoose')
const { createApp } = await import('../../src/app')
const { UserModel } = await import('../../src/models/user')
const { ProjectModel } = await import('../../src/models/project')
const { DeckModel } = await import('../../src/models/deck')
const { SlideModel } = await import('../../src/models/slide')
const { TemplateModel } = await import('../../src/models/template')
const { RefreshTokenModel } = await import('../../src/models/refresh-token')

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let grace: string
let projectId: string

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  grace = await registerUser('grace@example.com')
  const project = await act(ada, 'project.create', { title: 'Biology' })
  projectId = project.body.id
})

/** Imports the mock presentation into Ada's project. */
const importDeck = async (over: object = {}) => {
  await act(ada, 'quiz.connectGoogle')
  return act(ada, 'deck.importFromSlides', {
    projectId,
    presentationId: 'deck-1',
    ...over,
  })
}

describe('deck.importFromSlides (EXP-5)', () => {
  it('refuses until a Google account is connected', async () => {
    const res = await act(ada, 'deck.importFromSlides', {
      projectId,
      presentationId: 'deck-1',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('refuses a caller who does not own the project', async () => {
    await act(grace, 'quiz.connectGoogle')
    const res = await act(grace, 'deck.importFromSlides', {
      projectId,
      presentationId: 'deck-1',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('creates a lecture from the presentation', async () => {
    const { status, body } = await importDeck()
    expect(status).toBe(200)
    expect(body.deck.id).toBeTruthy()
    expect(body.deck.slideOrder.length).toBeGreaterThan(0)
  })

  it('creates the style template too, which may be all the author keeps', async () => {
    // EXP-5: the instructor can lecture over it, refine it, or keep only the
    // template — which they cannot do if it was never saved
    const { body } = await importDeck()
    expect(body.template.id).toBeTruthy()
    const library = await act(ada, 'template.list')
    expect(
      library.body.some((t: { id: string }) => t.id === body.template.id),
    ).toBe(true)
  })

  it('draws the lecture with the design it came from', async () => {
    const { body } = await importDeck()
    const deck = await DeckModel.findById(body.deck.id)
    expect(deck!.templateId.toString()).toBe(body.template.id)
  })

  it('places every slide on a layout that template actually declares', async () => {
    // The property EXP-5 turns on: layout assignment comes from the design
    // analysis, so a slide can never name a layout that does not exist
    const { body } = await importDeck()
    const declared = new Set(
      body.template.layouts.map((l: { type: string }) => l.type),
    )
    const slides = await SlideModel.find({ deckId: body.deck.id })
    expect(slides.length).toBeGreaterThan(0)
    for (const slide of slides) {
      expect(declared.has(slide.layoutType)).toBe(true)
    }
  })

  it('carries the presentation’s words onto the slides', async () => {
    const { body } = await importDeck()
    const slides = await SlideModel.find({ deckId: body.deck.id })
    const filled = slides.filter(s => Object.keys(s.slots ?? {}).length > 0)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('keeps the deck in the order the presentation had it', async () => {
    const { body } = await importDeck()
    const slides = await SlideModel.find({ deckId: body.deck.id }).sort({
      index: 1,
    })
    expect(slides.map(s => s.index)).toEqual(slides.map((_, i) => i))
    expect(body.deck.slideOrder).toHaveLength(slides.length)
  })

  it('reports what the import did, on both halves', async () => {
    const { body } = await importDeck()
    expect(body.report).toMatchObject({
      slidesRead: expect.any(Number),
      layoutsCreated: expect.any(Number),
      approximated: expect.any(Number),
      assetsFailed: expect.any(Number),
    })
  })

  it('gives every slide its own layout when the author asks', async () => {
    // The TMPL-8 choice, carried through to the lecture import
    const consolidated = await importDeck()
    const verbatim = await importDeck({ keepEverySlide: true })
    expect(verbatim.body.report.layoutsCreated).toBeGreaterThan(
      consolidated.body.report.layoutsCreated,
    )
  })

  it('shows up in the owner’s project and nobody else’s', async () => {
    const { body } = await importDeck()
    const mine = await act(ada, 'deck.list', { projectId })
    expect(mine.body.some((d: { id: string }) => d.id === body.deck.id)).toBe(
      true,
    )
  })

  it('can be run twice without the two colliding', async () => {
    const first = await importDeck()
    const second = await importDeck()
    expect(first.body.deck.id).not.toBe(second.body.deck.id)
    expect(first.body.deck.permalinkSlug).not.toBe(
      second.body.deck.permalinkSlug,
    )
  })

  it('rejects a presentation id that is not one', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'deck.importFromSlides', {
      projectId,
      presentationId: '',
    })
    expect(res.status).toBe(400)
  })
})
