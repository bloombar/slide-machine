/**
 * Integration tests for GEN-13: a slide the server promotes from an update
 * (heading pin, budget overflow, whiteboard canvas) is titled by the model
 * where that is foreseeable, left untitled where it is not — never headed by
 * a raw quote of the speaker's disfluency (`titleFromPhrase`, now removed).
 * An untitled slide then self-heals: the model is asked for a title on the
 * next phrase that reaches it, and that title is persisted. Drives a
 * scripted generation provider so each model decision is exact.
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

// A disfluent phrase, exactly the shape production logs showed feeding
// `titleFromPhrase`: its capitalized first six words are a recognizable,
// wrong title, so a test against them states the actual defect.
const DISFLUENT_PHRASE =
  'um so what you want to do is understand equivalent fractions'
const DISFLUENT_TITLE = 'Um So What You Want To'

describe('a slide the server promotes gets no raw-speech title (GEN-13)', () => {
  it('leaves a heading-slide promotion untitled when the model supplied none', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'title',
      slots: { title: 'Fractions' },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Fractions',
    })
    const titleId = first.body.slide.id as string

    // The heading pin promotes this to a new slide (body on a title layout);
    // the model, in delta mode, returns no title of its own.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: { body: 'A fraction names part of a whole' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(titleId)
    expect(next.body.slide.title).toBeFalsy()
    expect(next.body.slide.title).not.toBe(DISFLUENT_TITLE)
  })

  it('leaves a budget-overflow promotion untitled when the model supplied none', async () => {
    // GEN-8: the overflow promotion this test is about now defaults off —
    // turn it on for this deck directly (no admin user in this suite).
    await DeckModel.updateOne(
      { _id: deckId },
      { $set: { newSlideOverrideOverflow: true } },
    )
    // A list slide already loaded with 5 of its 6-bullet budget.
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        title: 'Fractions',
        bullets: ['Halves', 'Quarters', 'Thirds', 'Fifths', 'Sixths'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Fractions: halves, quarters, thirds, fifths, sixths',
    })
    const listId = first.body.slide.id as string

    // Two more bullets push the slide past its budget: server-side overflow
    // enforcement promotes this to a new slide. The model returned no title
    // (delta mode) — this case is decided AFTER the response, so the prompt
    // can't foresee it either.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: { bullets: ['Sevenths', 'Eighths'] },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(listId)
    expect(next.body.slide.title).toBeFalsy()
    expect(next.body.slide.title).not.toBe(DISFLUENT_TITLE)
  })

  it('leaves a whiteboard-canvas promotion untitled when the model supplied none', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: {
        title: 'Cell Structure',
        body: 'The cell membrane is a protective barrier',
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a protective barrier',
    })
    const whiteboardId = first.body.slide.id as string
    await act(ada, 'slide.setLayout', {
      slideId: whiteboardId,
      layoutType: 'whiteboard',
    })

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: { body: 'Mitochondria are the powerhouse of the cell' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(whiteboardId)
    expect(next.body.slide.title).toBeFalsy()
    expect(next.body.slide.title).not.toBe(DISFLUENT_TITLE)
  })
})

describe('a title the model wrote goes to the slide the prompt asked about, not wherever the promotion lands it (GEN-13 must-fix 1)', () => {
  it('at the heading-slide promotion site: the title heads the ORIGINAL slide, the new slide starts blank', async () => {
    // An untitled heading slide (as a self-heal in progress would leave it).
    scripted.push({ action: 'new', layoutType: 'title', slots: {} })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Fractions',
    })
    const titleId = first.body.slide.id as string
    expect(first.body.slide.title).toBeFalsy()

    // Delta reply carries a title for THIS untitled heading slide (the
    // `untitled` fragment's ask) AND body, which the header-pin rule reads
    // as content that must go to a new slide. The title is for the current
    // slide's own content — it must not ride along onto the new one.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: {
        title: 'Fractions Overview',
        body: 'A fraction names part of a whole',
      },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(titleId)
    expect(next.body.slide.title).toBeFalsy()

    const view = await act(ada, 'deck.get', { deckId })
    const original = view.body.slides.find(
      (s: { id: string }) => s.id === titleId,
    )
    expect(original.title).toBe('Fractions Overview')
  })

  it('at the budget-overflow promotion site: the title heads the ORIGINAL slide, the new slide starts blank', async () => {
    // GEN-8: the overflow promotion this test is about now defaults off —
    // turn it on for this deck directly (no admin user in this suite).
    await DeckModel.updateOne(
      { _id: deckId },
      { $set: { newSlideOverrideOverflow: true } },
    )
    // An untitled list slide already loaded with 5 of its 6-bullet budget.
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        bullets: ['Halves', 'Quarters', 'Thirds', 'Fifths', 'Sixths'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves, quarters, thirds, fifths, sixths',
    })
    const listId = first.body.slide.id as string
    expect(first.body.slide.title).toBeFalsy()

    // Delta reply carries a title (self-heal for the untitled current
    // slide) plus enough bullets to push the slide past its budget — the
    // server-side overflow rule promotes this to a new slide.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: { title: 'Fraction Names', bullets: ['Sevenths', 'Eighths'] },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(listId)
    expect(next.body.slide.title).toBeFalsy()

    const view = await act(ada, 'deck.get', { deckId })
    const original = view.body.slides.find(
      (s: { id: string }) => s.id === listId,
    )
    expect(original.title).toBe('Fraction Names')
  })

  it('at the whiteboard promotion site: the title heads the NEW slide, the whiteboard canvas is untouched', async () => {
    scripted.push({ action: 'new', layoutType: 'content', slots: {} })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Cell structure',
    })
    const whiteboardId = first.body.slide.id as string
    await act(ada, 'slide.setLayout', {
      slideId: whiteboardId,
      layoutType: 'whiteboard',
    })

    // Unlike the header-pin and overflow sites, the `untitled` fragment
    // never asks for a title for a whiteboard canvas (it has no text
    // slots), and the `capacity` fragment's whiteboard branch explicitly
    // asks for a title for the NEW slide this promotion is about to
    // create. So a title on this response belongs on the new slide, not
    // the whiteboard canvas it was generated alongside.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: {
        title: 'Cell Structure',
        body: 'Mitochondria are the powerhouse of the cell',
      },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(whiteboardId)
    expect(next.body.slide.title).toBe('Cell Structure')

    const view = await act(ada, 'deck.get', { deckId })
    const original = view.body.slides.find(
      (s: { id: string }) => s.id === whiteboardId,
    )
    expect(original.title).toBeFalsy()
  })
})

describe('an untitled slide self-heals on the next phrase (GEN-13)', () => {
  it('asks the model for a title only while the current slide has none', async () => {
    // First slide, untitled (as a promotion would leave it).
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { body: 'A fraction names part of a whole' },
    })
    await act(ada, 'session.phrase', { deckId, phrase: DISFLUENT_PHRASE })

    // Second phrase, still on the untitled slide: the prompt asks for one.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: {
        title: 'Equivalent Fractions',
        body: 'Halves equal two quarters',
      },
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves equal two quarters',
    })
    expect(requests[1]?.currentSlide?.titled).toBe(false)

    // Third phrase: the slide now has a title, so the prompt stops asking.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: { body: 'Thirds equal two sixths' },
    })
    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Thirds equal two sixths',
    })
    expect(requests[2]?.currentSlide?.titled).toBe(true)
  })

  it('persists a title a delta update supplies for an UNTITLED current slide', async () => {
    // The server promotes this without a title (mirrors the promotion tests
    // above, collapsed to the minimum needed to reach an untitled slide).
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { body: 'A fraction names part of a whole' },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: DISFLUENT_PHRASE,
    })
    const slideId = first.body.slide.id as string
    expect(first.body.slide.title).toBeFalsy()

    // The very next phrase's delta reply carries a title (self-healing) —
    // this is the line that decides whether the feature works at all: a
    // delta path that drops the title would leave the slide blank forever.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: {
        title: 'Equivalent Fractions',
        body: 'Halves equal two quarters',
      },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves equal two quarters',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(slideId)
    expect(next.body.slide.title).toBe('Equivalent Fractions')

    const view = await act(ada, 'deck.get', { deckId })
    const slide = view.body.slides.find((s: { id: string }) => s.id === slideId)
    expect(slide.title).toBe('Equivalent Fractions')
  })

  it('leaves an existing title alone when a compliant delta reply omits it', async () => {
    // On an already-titled slide the prompt does not ask for a title (see
    // the prompt-level test above), so a compliant delta reply carries none
    // — the negative counterpart of the self-heal test above: the untitled
    // fragment must not somehow cause a titled slide's heading to be
    // touched, or reset, when the model plays along and leaves it out.
    //
    // Note: a delta reply that DOES carry a title on an already-titled slide
    // is deliberately still accepted (unchanged, pre-existing behaviour —
    // see `declared-slot-editing.test.ts` and `header-layout-pin.test.ts`'s
    // "reverts a delta update" case): mid-lecture title correction ("actually,
    // call this one X") is a real, separate feature this slice does not touch.
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
    expect(first.body.slide.title).toBe('Fractions')

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content',
      slots: { body: 'Halves equal two quarters' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves equal two quarters',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(slideId)
    expect(next.body.slide.title).toBe('Fractions')
    expect(requests[1]?.currentSlide?.titled).toBe(true)
  })
})
