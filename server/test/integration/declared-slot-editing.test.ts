/**
 * Editing an authored box by talking (GEN-11).
 *
 * A box a template's author named — a code sample, a formula — holds ONE
 * thing, so an update replaces it rather than appending to it. That only works
 * if the model can see what is in the box: told "add a break once it reaches
 * zero" with no sight of the loop, the best it can do is write a different
 * loop, and the lecturer's listing is gone.
 *
 * So this asserts on the request the pipeline SENDS, not just the slide that
 * comes back: the current listing has to reach the model, whether or not
 * layouts may change, and it must not include boxes the slide's layout no
 * longer has.
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
import type {
  SlideGenerationRequest,
  SlideGenerationResult,
} from '@slide-machine/shared'

// The real env, but writable: one case here turns the layout-refit flag off to
// prove an authored box reaches the model without it. The parsed env is frozen
// in production, which is why this is a copy rather than a mutation.
vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>(
    '../../src/config/env',
  )
  return { ...actual, env: { ...actual.env } }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { registry } from '../../src/providers/registry'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'

/** Model decisions the next phrases receive, in order. */
const scripted: SlideGenerationResult[] = []
/** Every request the pipeline sent, so its inputs can be asserted. */
const requests: SlideGenerationRequest[] = []

// Replaces the deterministic mock under the configured provider name
// (GENERATION_PROVIDER=mock in tests), so each model decision is exact.
registry.register('generation', 'mock', () => ({
  name: 'mock',
  generateSlideContent: (req: SlideGenerationRequest) => {
    requests.push(req)
    const next = scripted.shift()
    if (!next) throw new Error('no scripted generation result')
    return Promise.resolve(next)
  },
}))

const server = createApp().listen(0)

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const LOOP = 'while n > 10:\n    n -= 1'
const LOOP_WITH_BREAK =
  'while n > 10:\n    n -= 1\n    if n == 0:\n        break'

let ada: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  scripted.length = 0
  requests.length = 0
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  const res = await request(server).post('/api/auth/register').send({
    email: 'ada@example.com',
    password: 'longenough1',
    displayName: 'Ada',
  })
  ada = res.body.accessToken as string

  // A design whose content layout carries a code box beside the title.
  const owner = await UserModel.findOne({ email: 'ada@example.com' })
  const template = await TemplateModel.create({
    ownerId: owner!._id,
    name: 'Programming',
    permalinkSlug: `programming-${Date.now()}`,
    theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
    layouts: [
      {
        type: 'content',
        label: 'Content',
        purpose: 'a worked example',
        slots: [
          { name: 'title', kind: 'text', label: 'Title' },
          {
            name: 'snippet',
            kind: 'code',
            label: 'Sample',
            options: { language: 'python' },
          },
        ],
        elementPositions: {},
      },
      {
        type: 'list',
        label: 'Bullet list',
        purpose: 'parallel points',
        slots: [
          { name: 'title', kind: 'text', label: 'Title' },
          { name: 'bullets', kind: 'bullets', label: 'Points' },
        ],
        elementPositions: {},
      },
    ],
    visibility: 'private',
  })
  const project = await act(ada, 'project.create', { title: 'Programming' })
  const created = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Loops',
    templateId: String(template._id),
  })
  // Pointed at this design, unpinned, so generation sees the boxes it declares
  await DeckModel.updateOne(
    { _id: created.body.id },
    {
      $set: { templateId: String(template._id) },
      $unset: { templateVersionId: '' },
    },
  )
  deckId = created.body.id as string
})

/** Opens the lecture with a slide whose code box holds `LOOP`. */
const slideWithLoop = async (): Promise<string> => {
  scripted.push({
    action: 'new',
    layoutType: 'content',
    slots: { title: 'While loops' },
    declared: { snippet: { kind: 'code', source: LOOP, language: 'python' } },
  })
  const first = await act(ada, 'session.phrase', {
    deckId,
    phrase: 'a while loop that counts down from ten',
  })
  return first.body.slide.id as string
}

describe('the model sees what an authored box already holds', () => {
  it('sends the current listing with the next phrase', async () => {
    await slideWithLoop()

    scripted.push({ action: 'none', layoutType: 'content', slots: {} })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'and add a break once it reaches zero',
    })

    expect(requests[1]?.currentSlide?.content?.declared).toEqual({
      snippet: { kind: 'code', source: LOOP, language: 'python' },
    })
  })

  it('sends nothing for the first phrase of an empty lecture', async () => {
    scripted.push({ action: 'none', layoutType: 'content', slots: {} })
    await act(ada, 'session.phrase', { deckId, phrase: 'good morning' })
    expect(requests[0]?.currentSlide).toBeUndefined()
  })

  it('sends it even when layouts may not change', async () => {
    // Replacement is how an authored box works, not part of the refit bargain
    const refit = env.GENERATION_LAYOUT_REFIT
    env.GENERATION_LAYOUT_REFIT = false
    try {
      await slideWithLoop()
      scripted.push({ action: 'none', layoutType: 'content', slots: {} })
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'and add a break once it reaches zero',
      })

      const content = requests[1]?.currentSlide?.content
      expect(content?.declared?.snippet).toMatchObject({ source: LOOP })
      // The conventional four still ride the refit flag: without a re-map to
      // do, re-showing them invites the model to restate the whole slide
      expect(content?.title).toBeUndefined()
    } finally {
      env.GENERATION_LAYOUT_REFIT = refit
    }
  })

  it('leaves out a box the slide’s current layout no longer has', async () => {
    // The slide keeps content its old layout held, so it is not lost on the
    // way back — but a box that is not on screen must not be offered for edit
    const slideId = await slideWithLoop()
    await act(ada, 'slide.setLayout', { slideId, layoutType: 'list' })

    scripted.push({ action: 'none', layoutType: 'list', slots: {} })
    await act(ada, 'session.phrase', { deckId, phrase: 'in three steps' })

    expect(
      requests[requests.length - 1]?.currentSlide?.content?.declared,
    ).toBeUndefined()
  })
})

describe('the edited box comes back whole', () => {
  it('replaces the listing with the complete new one', async () => {
    const slideId = await slideWithLoop()

    // What the prompt asks for: the whole box, edited — not the added lines
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: {},
      declared: {
        snippet: { kind: 'code', source: LOOP_WITH_BREAK, language: 'python' },
      },
    })
    const res = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'and add a break once it reaches zero',
    })

    expect(res.body.kind).toBe('slide.update')
    expect(res.body.slide.id).toBe(slideId)
    const slide = await SlideModel.findById(slideId)
    expect(slide?.slots?.snippet).toMatchObject({
      kind: 'code',
      source: LOOP_WITH_BREAK,
    })
  })

  it('leaves the listing alone when the phrase does not touch it', async () => {
    // An update that omits the box keeps what is there — silence is not "empty"
    const slideId = await slideWithLoop()

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: { title: 'Counting down' },
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'this is how you count down',
    })

    const slide = await SlideModel.findById(slideId)
    expect(slide?.title).toBe('Counting down')
    expect(slide?.slots?.snippet).toMatchObject({ source: LOOP })
  })
})
