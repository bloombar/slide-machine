/**
 * Integration tests for GEN-14: a slide never says the same thing twice.
 * An additive update that repeats a bullet already on the slide (speech
 * doubles back, or the model re-emits a line it already wrote) must not
 * store the repeat. Drives a scripted generation provider so each model
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
  const project = await act(ada, 'project.create', { title: 'Backups' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('an additive update never stores a bullet the slide already holds (GEN-14)', () => {
  it('drops an exact repeat, keeping one copy', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        title: 'Backups',
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Automatically keep backups to safely revert changes',
    })
    const slideId = first.body.slide.id as string

    // The instructor restates the same point; the model re-emits it as a
    // delta update, the production defect exactly.
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: {
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Automatically keep backups to safely revert changes',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual([
      'Automatically keep backups to safely revert changes',
    ])
  })

  it('treats a case/whitespace variant as the same repeat', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        title: 'Backups',
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Automatically keep backups to safely revert changes',
    })
    const slideId = first.body.slide.id as string

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: {
        bullets: ['  automatically Keep Backups TO Safely Revert Changes  '],
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'automatically keep backups to safely revert changes',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual([
      'Automatically keep backups to safely revert changes',
    ])
  })

  it('lands one copy when a single response repeats a bullet within its own batch', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Backups' },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Backups',
    })
    const slideId = first.body.slide.id as string

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: {
        bullets: [
          'Automatically keep backups to safely revert changes',
          'Automatically keep backups to safely revert changes',
        ],
      },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase:
        'Automatically keep backups. Automatically keep backups to safely revert changes',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual([
      'Automatically keep backups to safely revert changes',
    ])
  })

  it('still appends a genuinely new bullet normally', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        title: 'Backups',
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Automatically keep backups to safely revert changes',
    })
    const slideId = first.body.slide.id as string

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: { bullets: ['Restore from a backup after a failed migration'] },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Restore from a backup after a failed migration',
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual([
      'Automatically keep backups to safely revert changes',
      'Restore from a backup after a failed migration',
    ])
  })

  it('still counts as an update when every incoming bullet is a repeat: transcript grows, slide saves, client is told', async () => {
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: {
        title: 'Backups',
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Automatically keep backups to safely revert changes',
    })
    const slideId = first.body.slide.id as string

    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: {
        bullets: ['Automatically keep backups to safely revert changes'],
      },
    })
    const repeatPhrase =
      'Automatically keep backups to safely revert changes, again'
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: repeatPhrase,
    })
    // Not converted to 'none': the client is still told an update happened.
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual([
      'Automatically keep backups to safely revert changes',
    ])
    // The slide is still saved with the phrase folded into its transcript
    // (the speaker did say it — it simply was not new).
    const saved = await SlideModel.findById(slideId)
    expect(saved?.sourceTranscript).toContain(repeatPhrase)
  })
})

// Every case above sits at 1 existing + 1 incoming bullet, far under any
// layout's bullet budget — no case above ever reaches a capacity decision.
// The cases below sit AT that budget, where dedup and capacity interact:
// updateOverflows, refitOverflows and clampToBudget all read
// `slots.bullets` before the append-site dedup ever runs, so a duplicate
// present at that point can still consume a budgeted slot or trip an
// overflow it should never have caused.
describe('dedup at the layout bullet budget (GEN-14)', () => {
  /** Plain, easy-to-diff bullet labels. */
  const points = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `Point ${i + 1}`)

  /**
   * Sends far more bullets than any plausible layout allows and reads back
   * how many actually landed — the `list` layout's own bullet cap,
   * discovered from the running app rather than assumed. `slotLimits` fits
   * a box's capacity to its own measured geometry (TMPL-6), so the number
   * is a property of the template's design and the deployment's fonts, not
   * a constant safe to hardcode (it is NOT always the raw
   * `constraints.maxBullets` a template's JSON states).
   */
  const discoverBulletCap = async (): Promise<number> => {
    const project = await act(ada, 'project.create', { title: 'Cap probe' })
    const probeDeck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Cap probe',
      templateId: 'classic',
    })
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Cap probe', bullets: points(20) },
    })
    const res = await act(ada, 'session.phrase', {
      deckId: probeDeck.body.id,
      phrase: 'probe',
    })
    return (res.body.slide.bullets as string[]).length
  }

  it('a pure-repeat update at a full slide stays a plain update, not a new slide', async () => {
    const cap = await discoverBulletCap()
    const full = points(cap)
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Backups', bullets: full },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: full.join('. '),
    })
    const slideId = first.body.slide.id as string
    expect(first.body.slide.bullets).toEqual(full)

    // The slide is already at the layout's bullet budget. A phrase that
    // only restates a point already there must not count against that
    // budget: before the fix, updateOverflows read the raw incoming list
    // (still holding the repeat), saw the slide's own count plus one more
    // exceed the budget, and promoted this to a new slide whose only
    // content was the repeat — a slide saying exactly what the previous
    // slide already said.
    const repeated = full[Math.floor(cap / 2)]!
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: { bullets: [repeated] },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: `${repeated}, again`,
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual(full)
  })

  it('a repeat mixed with a genuine point at a full slide promotes with only the genuine point', async () => {
    const cap = await discoverBulletCap()
    const full = points(cap)
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Backups', bullets: full },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: full.join('. '),
    })
    const slideId = first.body.slide.id as string

    // The slide is full; the first point is a repeat, "Brand new point" is
    // genuinely new. The repeat's presence still forces an overflow (the
    // slide has no room for even one more bullet), but the promoted slide
    // must hold only the genuine point — before the fix, the new-slide
    // path only deduped within its own batch, so the repeat rode along
    // onto the new slide too.
    const repeated = full[0]!
    scripted.push({
      action: 'update',
      updateMode: 'delta',
      layoutType: 'list',
      slots: { bullets: [repeated, 'Brand new point'] },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: `${repeated}, again, and also brand new point`,
    })
    expect(second.body.kind).toBe('slide.new')
    expect(second.body.slide.id).not.toBe(slideId)
    expect(second.body.slide.bullets).toEqual(['Brand new point'])
  })

  it('a within-batch repeat on a brand-new slide never costs a budgeted slot to a genuine trailing bullet', async () => {
    const cap = await discoverBulletCap()
    const full = points(cap)
    // One extra entry, repeating the first label, on top of a full unique
    // set. Unique count is exactly the budget, so every genuine bullet
    // should survive. Before the fix, clampToBudget sliced the RAW list to
    // the layout's bullet count and only then deduped, permanently losing
    // the unique trailing point that the slice cut off to make room for
    // the duplicate.
    const withDuplicate = [full[0]!, ...full]
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Backups', bullets: withDuplicate },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: withDuplicate.join('. '),
    })
    expect(first.body.kind).toBe('slide.new')
    expect(first.body.slide.bullets).toEqual(full)
  })

  it('a within-batch repeat in a refit no longer trips a false overflow discard', async () => {
    const cap = await discoverBulletCap()
    const full = points(cap)
    scripted.push({
      action: 'new',
      layoutType: 'list',
      slots: { title: 'Backups', bullets: [full[0]!, full[1]!] },
    })
    const first = await act(ada, 'session.phrase', {
      deckId,
      phrase: `${full[0]}. ${full[1]}.`,
    })
    const slideId = first.body.slide.id as string

    // A same-layout refit re-states the whole slide (title included, since
    // a refit provides the COMPLETE slide). Its own response repeats the
    // last point within itself; deduped, it is exactly at the layout's
    // budget and should apply. Before the fix, refitOverflows counted the
    // raw over-budget list and discarded the entire refit (kind: 'none'),
    // losing the genuinely new points along with the repeat.
    const withDuplicate = [...full, full[cap - 1]!]
    scripted.push({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
      slots: { title: 'Backups', bullets: withDuplicate },
    })
    const second = await act(ada, 'session.phrase', {
      deckId,
      phrase: full.join(', '),
    })
    expect(second.body.kind).toBe('slide.update')
    expect(second.body.slide.id).toBe(slideId)
    expect(second.body.slide.bullets).toEqual(full)
  })
})
