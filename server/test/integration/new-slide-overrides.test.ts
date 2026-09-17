/**
 * Integration tests for the GEN-8 admin overrides: per-lecture switches that
 * turn the server's automatic update->new-slide promotions (header,
 * overflow, whiteboard, drawing-in-progress) on or off, for experimentation.
 * Covers the authorization gate (admin-only, both sides of the ACL) and,
 * for each switch, its own default plus the explicit opposite: header,
 * whiteboard and drawing-in-progress default on (unset promotes); overflow
 * defaults off (unset leaves the update in place). Drives a scripted
 * generation provider so each model decision is exact. MongoDB real.
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
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

const ADMIN_EMAIL = 'admin@example.com'

/** Model decisions the next phrases receive, in order. */
const scripted: SlideGenerationResult[] = []

registry.register('generation', 'mock', () => ({
  name: 'mock',
  generateSlideContent: (_req: SlideGenerationRequest) => {
    const next = scripted.shift()
    if (!next) throw new Error('no scripted generation result')
    return Promise.resolve(next)
  },
}))

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

const viewDeck = (token: string, slug: string) =>
  request(server)
    .get(`/api/decks/${slug}`)
    .set('Authorization', `Bearer ${token}`)

let ada: string
let admin: string
let bob: string
let deckId: string
let deckSlug: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SettingsChangeLogModel.init(),
  ])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
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
    SettingsChangeLogModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  admin = await registerUser(ADMIN_EMAIL)
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Fractions' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
  deckSlug = deck.body.permalinkSlug
})

describe('deck.setNewSlideOverrides authorization', () => {
  it('refuses the owner when they are not an admin', async () => {
    const res = await act(ada, 'deck.setNewSlideOverrides', {
      deckId,
      header: false,
    })
    expect(res.status).toBe(403)
    expect(
      (await DeckModel.findById(deckId))!.newSlideOverrideHeader,
    ).toBeUndefined()
  })

  it('lets an admin set overrides on another user’s lecture, persisted and logged', async () => {
    const res = await act(admin, 'deck.setNewSlideOverrides', {
      deckId,
      header: false,
      overflow: false,
    })
    expect(res.status).toBe(200)
    expect(res.body.newSlideOverrideHeader).toBe(false)
    expect(res.body.newSlideOverrideOverflow).toBe(false)

    const doc = await DeckModel.findById(deckId)
    expect(doc!.newSlideOverrideHeader).toBe(false)
    expect(doc!.newSlideOverrideOverflow).toBe(false)

    const entries = await SettingsChangeLogModel.find()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.changes).toEqual({
      newSlideOverrideHeader: { from: null, to: false },
      newSlideOverrideOverflow: { from: null, to: false },
    })
  })

  it('re-inherits the default when set to null', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, header: false })
    const res = await act(admin, 'deck.setNewSlideOverrides', {
      deckId,
      header: null,
    })
    expect(res.status).toBe(200)
    expect(res.body.newSlideOverrideHeader).toBeUndefined()
  })
})

describe('new-slide override switches on the wire', () => {
  it('returns the switches to the owner', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })
    const res = await viewDeck(ada, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.newSlideOverrideOverflow).toBe(false)
  })

  it('returns the switches to an allowlisted admin', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })
    const res = await viewDeck(admin, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.newSlideOverrideOverflow).toBe(false)
  })

  it('omits the switches from a shared viewer (admin experiment metadata)', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })
    // Sharing needs a confirmed owner address, and only grants immediately
    // to a confirmed recipient (SHARE-3) — both waived by directly marking
    // the accounts verified here.
    await UserModel.updateOne(
      { email: 'ada@example.com' },
      { emailVerified: true },
    )
    await UserModel.updateOne(
      { email: 'bob@example.com' },
      { emailVerified: true },
    )
    await act(ada, 'deck.share', {
      deckId,
      email: 'bob@example.com',
      role: 'viewer',
    })
    const res = await viewDeck(bob, deckSlug)
    expect(res.status).toBe(200)
    expect(res.body.deck.newSlideOverrideOverflow).toBeUndefined()
    expect(res.body.deck.newSlideOverrideHeader).toBeUndefined()
    expect(res.body.deck.newSlideOverrideWhiteboard).toBeUndefined()
    expect(res.body.deck.newSlideOverrideDrawing).toBeUndefined()
  })
})

describe('header override (GEN-8)', () => {
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
    return first.body.slide.id as string
  }

  it('off: an update carrying body/bullets lands on the header slide in place', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, header: false })
    const titleId = await openWithTitleSlide()

    scripted.push({
      action: 'update',
      layoutType: 'title',
      slots: { bullets: ['Halves', 'Quarters'] },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves and quarters',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(titleId)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
  })

  it('on (unset): the same update is promoted to a new slide', async () => {
    const titleId = await openWithTitleSlide()

    scripted.push({
      action: 'update',
      layoutType: 'title',
      slots: { bullets: ['Halves', 'Quarters'] },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Halves and quarters',
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(titleId)
  })
})

describe('overflow override (GEN-8)', () => {
  // A short body, comfortably under any measured budget, so creation itself
  // never clamps it — the point of this test is what happens to the UPDATE.
  const INTRO = 'Intro to fractions'

  const openContentSlide = async (): Promise<string> => {
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Fractions', body: INTRO },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Fractions intro',
    })
    expect(first.body.slide.body).toBe(INTRO)
    return first.body.slide.id as string
  }

  it('off: an overflowing update lands in place, unclamped', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })
    const slideId = await openContentSlide()

    // Long enough to overflow any layout's measured body budget.
    const addition = 'y'.repeat(2000)
    scripted.push({
      action: 'update',
      layoutType: 'content',
      slots: { body: addition },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'more content',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(slideId)
    // Appended verbatim, no clamp: the additive update path joins with a
    // single space and never trims when the override is off.
    expect(next.body.slide.body).toBe(`${INTRO} ${addition}`)
  })

  it('unset: the same overflowing update lands in place, unclamped (GEN-8 default off)', async () => {
    const slideId = await openContentSlide()

    const addition = 'y'.repeat(2000)
    scripted.push({
      action: 'update',
      layoutType: 'content',
      slots: { body: addition },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'more content',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(slideId)
    expect(next.body.slide.body).toBe(`${INTRO} ${addition}`)
  })

  it('on (explicit): the same overflowing update is promoted to a new slide', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: true })
    const slideId = await openContentSlide()

    const addition = 'y'.repeat(2000)
    scripted.push({
      action: 'update',
      layoutType: 'content',
      slots: { body: addition },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'more content',
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(slideId)

    // The original slide is untouched.
    const view = await act(ada, 'deck.get', { deckId })
    const original = view.body.slides.find(
      (s: { id: string }) => s.id === slideId,
    )
    expect(original.body).toBe(INTRO)
  })
})

describe('whiteboard override (GEN-8)', () => {
  const openWhiteboardSlide = async (): Promise<string> => {
    const added = await act(ada, 'slide.add', {
      deckId,
      layoutType: 'whiteboard',
    })
    return added.body.id as string
  }

  it('off: an update to the whiteboard slide lands on its document in place', async () => {
    await act(admin, 'deck.setNewSlideOverrides', {
      deckId,
      whiteboard: false,
    })
    const whiteboardId = await openWhiteboardSlide()

    scripted.push({
      action: 'update',
      layoutType: 'whiteboard',
      slots: { body: 'Mitochondria are the powerhouse of the cell' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(whiteboardId)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
  })

  it('on (unset): the same update creates a new slide instead', async () => {
    const whiteboardId = await openWhiteboardSlide()

    scripted.push({
      action: 'update',
      layoutType: 'whiteboard',
      slots: { body: 'Mitochondria are the powerhouse of the cell' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(whiteboardId)
  })
})

describe('drawing-in-progress override (GEN-8)', () => {
  /** A first slide, so there is a "current slide" to fold into / compare to. */
  const openFirstSlide = async (): Promise<string> => {
    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Cells', body: 'The cell membrane is a barrier' },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'The cell membrane is a barrier',
    })
    return first.body.slide.id as string
  }

  it('off: a new slide is created as usual even while suppressNewSlide is set', async () => {
    await act(admin, 'deck.setNewSlideOverrides', { deckId, drawing: false })
    const firstId = await openFirstSlide()

    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Mitochondria', body: 'The powerhouse of the cell' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
      suppressNewSlide: true,
    })
    expect(next.body.kind).toBe('slide.new')
    expect(next.body.slide.id).not.toBe(firstId)
  })

  it('on (unset): the phrase is folded into the current slide’s transcript instead', async () => {
    const firstId = await openFirstSlide()

    scripted.push({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Mitochondria', body: 'The powerhouse of the cell' },
    })
    const next = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Mitochondria are the powerhouse of the cell',
      suppressNewSlide: true,
    })
    expect(next.body.kind).toBe('slide.update')
    expect(next.body.slide.id).toBe(firstId)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(1)
  })
})
