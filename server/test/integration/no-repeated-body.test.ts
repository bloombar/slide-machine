/**
 * Integration tests for GEN-8: a delta update's body is meant to ADD
 * material, not resend it. The model sometimes echoes the current slide's
 * body verbatim; left in, `updateOverflows` counted it against the budget
 * TWICE (current + incoming) and the additive append then printed it twice
 * on the slide. Drives a scripted generation provider so each model
 * decision is exact, in the same style as no-duplicate-bullets.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { SlideGenerationResult } from '@slide-machine/shared'

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

// Replaces the deterministic mock under the configured provider name
// (GENERATION_PROVIDER=mock in tests). Registered before the first phrase, so
// the registry instantiates this adapter rather than the real mock.
registry.register('generation', 'mock', () => ({
  name: 'mock',
  generateSlideContent: () => {
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
  const project = await act(ada, 'project.create', { title: 'Notes' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

/**
 * A single run-on "sentence" (no internal punctuation) far longer than any
 * plausible body budget. Sent as a "new" slide's body, the server's own
 * `clampToBudget` cuts it to the layout's actual effective limit (a property
 * of the template's rendered geometry, not the raw JSON constraint —
 * discovered by probing rather than assumed, same reasoning as
 * `discoverBulletCap` in no-duplicate-bullets.test.ts). The clamped text
 * that comes back is therefore a slide's body sitting AT its own limit.
 */
const longRunOn = Array.from({ length: 200 }, (_, i) => `filler${i}`).join(' ')

describe("a delta that resends the slide's own body (GEN-8)", () => {
  it('updates in place, without duplicating the body, on a slide already near its body limit', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'content-list',
      slots: { title: 'Notes', body: longRunOn },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: longRunOn,
    })
    const slideId = first.body.slide.id as string
    // Clamped to the layout's effective budget: shorter than the raw text.
    const existingBody = first.body.slide.body as string
    expect(existingBody.length).toBeLessThan(longRunOn.length)

    // The model re-emits the slide's own body verbatim as a delta update —
    // the production defect exactly. Before the fix this counted
    // existingBody.length + existingBody.length against the budget, which
    // is always over it, and promoted a new slide holding only the repeat.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content-list',
      slots: { body: existingBody },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'repeats what was just said',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    // Not doubled: the resent text contributed nothing new.
    expect(second.body.slide.body).toBe(existingBody)
  })

  it('still promotes a genuinely overflowing delta to a new slide (overflow override explicitly on)', async () => {
    // Set explicitly rather than relying on the unset/default value — this
    // test is about the dedupe not masking a genuine overflow, not about
    // what the override defaults to (which a separate admin-switches slice
    // owns and may change).
    await DeckModel.updateOne(
      { _id: deckId },
      { newSlideOverrideOverflow: true },
    )
    scripted.push({
      action: 'new',
      layoutType: 'content-list',
      slots: { title: 'Notes', body: longRunOn },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: longRunOn,
    })
    const slideId = first.body.slide.id as string
    const existingBody = first.body.slide.body as string

    // Genuinely new material, not a repeat — with the slide already at its
    // body limit, adding this must still overflow and promote (GEN-8's
    // existing new-slide-on-overflow behaviour, unaffected by this fix).
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content-list',
      slots: {
        body: 'A brand new point the speaker just raised, unrelated to anything said before.',
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'a brand new point',
    })
    expect(second.body.kind).toBe('slide.new')
    expect(second.body.slide.id).not.toBe(slideId)
    // The original slide's body is untouched by the promoted phrase.
    const original = await SlideModel.findById(slideId)
    expect(original?.body).toBe(existingBody)
  })

  it('applies a genuinely new bullet from the same response without duplicating the resent body', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'content-list',
      slots: {
        title: 'Notes',
        body: 'Photosynthesis converts light into chemical energy.',
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis converts light into chemical energy',
    })
    const slideId = first.body.slide.id as string

    // The model resends the existing body verbatim AND adds a genuinely new
    // bullet in the same delta — the body contributes nothing new, but the
    // bullet still must land.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'content-list',
      slots: {
        body: 'Photosynthesis converts light into chemical energy.',
        bullets: ['Chlorophyll absorbs the light'],
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'chlorophyll absorbs the light',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual(['Chlorophyll absorbs the light'])
    expect(second.body.slide.body).toBe(
      'Photosynthesis converts light into chemical energy.',
    )
  })
})

describe('a refit that falls back to the additive path still dedupes its body (GEN-8/GEN-14)', () => {
  it('does not duplicate the body when a refit is offered while the user is drawing (keepLayout)', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'content-list',
      slots: {
        title: 'Notes',
        body: 'Photosynthesis converts light into chemical energy.',
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Photosynthesis converts light into chemical energy',
    })
    const slideId = first.body.slide.id as string

    // A refit response — same layout, COMPLETE slide restated — arrives
    // while the user is drawing (`suppressNewSlide`, WB-3). `keepLayout`
    // blocks the refit from actually applying, so this falls through to
    // the plain additive path with `updateMode` still reading 'refit'.
    // Before the fix, the body dedupe keyed off that leftover field and
    // skipped, so the additive append printed the whole repeated sentence
    // a second time ahead of the genuinely new one.
    scripted.push({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'content-list',
      slots: {
        title: 'Notes',
        body: 'Photosynthesis converts light into chemical energy. Chlorophyll absorbs the light.',
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'chlorophyll absorbs the light, while I annotate this',
      suppressNewSlide: true,
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.body).toBe(
      'Photosynthesis converts light into chemical energy. Chlorophyll absorbs the light.',
    )
  })
})
