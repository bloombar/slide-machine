/**
 * Integration test for the heading-slide layout pin: a title/section slide —
 * the card a live lecture opens with — never has its layout changed by
 * generation. A refit onto a different layout spills to a new slide, a delta
 * layout switch is reverted, and a same-layout refit still sharpens the
 * heading in place. Drives a scripted generation provider so each model
 * decision is exact.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type {
  SlideGenerationRequest,
  SlideGenerationResult,
} from '@slide-machine/shared'

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { registry } from '../../src/providers/registry'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

/** Model decisions the next phrases receive, in order. */
const scripted: SlideGenerationResult[] = []
/** Every request the pipeline sent, so the prompt inputs can be asserted. */
const requests: SlideGenerationRequest[] = []

// Replaces the deterministic mock under the configured provider name
// (GENERATION_PROVIDER=mock in tests). Registered before the first phrase, so
// the registry instantiates this adapter rather than the real mock.
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
afterAll(() => server.close())

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
  scripted.length = 0
  requests.length = 0
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  const res = await request(server).post('/api/auth/register').send({
    email: 'ada@example.com',
    password: 'longenough1',
    displayName: 'Ada',
  })
  ada = res.body.accessToken as string
  const project = await act(ada, 'project.create', { title: 'Arithmetic' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

/** Opens the deck with a title slide and returns its id. */
const openWithTitleSlide = async (): Promise<string> => {
  scripted.push({
    action: 'new',
    layoutType: 'title',
    slots: { title: 'Fractions' },
  })
  const first = await act(ada, 'session.phrase', {
    deckId,
    phrase: 'Fractions',
  })
  expect(first.body.slide.layoutType).toBe('title')
  return first.body.slide.id as string
}

describe('heading slides pin their layout during live generation', () => {
  it('spills a layout-changing refit onto a new slide, leaving the title slide intact', async () => {
    const titleId = await openWithTitleSlide()

    // The model wants the title card re-mapped to a list. Its layout is pinned,
    // so the material becomes a new slide instead of restructuring the opener.
    scripted.push({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
      slots: {
        title: 'Fractions',
        bullets: ['Halves', 'Quarters', 'Thirds'],
      },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Also halves, quarters, and thirds',
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(titleId)
    expect(next.body.slide.bullets).toEqual(['Halves', 'Quarters', 'Thirds'])

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(2)
    const title = view.body.slides.find((s: { id: string }) => s.id === titleId)
    expect(title.layoutType).toBe('title')
    expect(title.bullets ?? []).toHaveLength(0)

    // The model was told the layout is pinned, not just overruled after the fact
    expect(requests[1]?.pinLayout).toBe(true)
  })

  it('reverts a delta update that proposes a different layout', async () => {
    const titleId = await openWithTitleSlide()

    // A title-only delta onto "section" — a layout that would display every
    // populated slot, so without the pin the switch would be kept.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'section',
      slots: { title: 'Fractions Today' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Fractions today',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(titleId)
    expect(next.body.slide.layoutType).toBe('title')
    expect(next.body.slide.title).toBe('Fractions Today')
  })

  it('still applies a same-layout refit in place (a sharper heading)', async () => {
    const titleId = await openWithTitleSlide()

    scripted.push({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'title',
      slots: { title: 'Understanding Fractions', caption: 'Parts of a whole' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Today we are understanding fractions',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(titleId)
    expect(next.body.slide.layoutType).toBe('title')
    expect(next.body.slide.title).toBe('Understanding Fractions')
    expect(next.body.slide.caption).toBe('Parts of a whole')

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
  })

  it('leaves ordinary content slides free to refit', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Fractions', body: 'A fraction names part of a whole' },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'A fraction names part of a whole',
    })
    const slideId = first.body.slide.id as string
    expect(first.body.slide.layoutType).toBe('content')

    // Not a heading: the pin does not apply and the refit lands in place
    scripted.push({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
      slots: {
        title: 'Fractions',
        bullets: ['A fraction names part of a whole', 'Halves', 'Thirds'],
      },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Also halves and thirds',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(slideId)
    expect(next.body.slide.layoutType).toBe('list')
    expect(requests[1]?.pinLayout).toBe(false)
  })
})
