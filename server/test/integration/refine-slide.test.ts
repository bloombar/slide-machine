/**
 * Integration test for the single-slide "Refine this slide" action
 * (deck.refineSlide, GEN-4): it refines one slide using the lecture's persisted
 * Refine settings (which passes are on + their levels), leaves every other
 * slide untouched, keeps TTS narration in-line, protects hand-edited slides,
 * and gates on edit access. Also covers deck.refineSlideTranscript, the
 * transcript editor's narration-only refine, which shares that pass and level.
 * MongoDB real; mock providers.
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
import type { GenerationProvider } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { registry } from '../../src/providers/registry'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel } from '../../src/models/template'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefreshTokenModel } from '../../src/models/refresh-token'

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
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(disconnectMongo)

/** Two slides; returns their ids. The first is the refine target. */
const seedSlides = async (): Promise<{ target: string; other: string }> => {
  const target = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    title: 'Photosynthesis',
    body: 'Plants convert light to energy',
  })
  const other = await SlideModel.create({
    deckId,
    index: 1,
    layoutType: 'content',
    title: 'Respiration',
    body: 'Cells release energy',
  })
  return { target: target._id.toString(), other: other._id.toString() }
}

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TemplateModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('deck.refineSlide', () => {
  it('refines only the target slide, at the default levels, and re-narrates it', async () => {
    const { target, other } = await seedSlides()

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.status).toBe(200)
    expect(res.body.refined).toBe(true)
    expect(res.body.narrationUpdated).toBe(true)
    // The DTO is the freshly-refined slide.
    expect(res.body.slide.id).toBe(target)
    expect(res.body.slide.caption).toBe(
      `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
    )

    // Target: content refined (caption) + narration in-line with its content.
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBe(
      `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
    )
    expect(t?.sourceTranscript).toContain('Photosynthesis')

    // The other slide is untouched.
    const o = await SlideModel.findById(other)
    expect(o?.caption).toBeUndefined()
    expect(o?.sourceTranscript).toBeUndefined()
  })

  it("uses the lecture's saved slider level", async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', { deckId, slidesLevel: 5 })

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBe('Refined (level 5)')
  })

  it('skips the content pass when slides are disabled but still narrates', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      transcriptEnabled: true,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(false)
    expect(res.body.narrationUpdated).toBe(true)
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined() // content untouched
    expect(t?.sourceTranscript).toContain('Photosynthesis') // narration updated
  })

  it('re-narrates even when transcript is disabled, because the content changed', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: true,
      transcriptEnabled: false,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(true)
    // TTS must stay in-line, so a content change forces a re-narration.
    expect(res.body.narrationUpdated).toBe(true)
  })

  it('does nothing when both slide-applicable passes are off', async () => {
    const { target } = await seedSlides()
    await act(ada, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      transcriptEnabled: false,
    })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body).toMatchObject({ refined: false, narrationUpdated: false })
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined()
    expect(t?.sourceTranscript).toBeUndefined()
  })

  it('protects a hand-edited slide from the content pass', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne({ _id: target }, { manuallyEdited: true })

    const res = await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(res.body.refined).toBe(false)
    const t = await SlideModel.findById(target)
    expect(t?.caption).toBeUndefined()
    // Narration still refreshes (transcript pass defaults on).
    expect(res.body.narrationUpdated).toBe(true)
  })

  it('frames the narration as a question for a student slide', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toMatch(/^A student asked:/)
  })

  it('refines the existing narration further on each pass (incremental)', async () => {
    const { target } = await seedSlides()
    // Give the slide an original spoken transcript, as a live session would.
    await SlideModel.updateOne(
      { _id: target },
      { sourceTranscript: 'The original spoken words.' },
    )

    // First refine builds on the original transcript.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const after1 = await SlideModel.findById(target)
    expect(after1?.sourceTranscript).toContain('The original spoken words.')
    expect(after1?.sourceTranscript).toContain('(refined)')

    // Second refine builds on the first refinement — it compounds, and never
    // reverts to narrating from the slide's title/body.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const after2 = await SlideModel.findById(target)
    expect(after2?.sourceTranscript).toContain('The original spoken words.')
    expect(after2?.sourceTranscript).toMatch(/\(refined\).*\(refined\)/s)
    expect(after2?.sourceTranscript).not.toContain('Photosynthesis')
  })

  it('rescales whiteboard stroke anchors when the narration is rewritten (WB-2)', async () => {
    const { target } = await seedSlides()
    // A 20-char transcript with a stroke drawn at the halfway point and later
    // erased at the end. The mock narrator appends " (refined)" → 30 chars.
    await SlideModel.updateOne(
      { _id: target },
      {
        sourceTranscript: 'Photosynthesis rocks', // 20 chars
        drawings: [
          {
            id: 'd1',
            tool: 'pen',
            color: '#1e293b',
            thickness: 0.01,
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.2 },
            ],
            startedAt: '2026-07-21T10:00:00.000Z',
            endedAt: '2026-07-21T10:00:01.000Z',
            anchor: { charAnchor: 10, source: 'appended' },
            erasedAnchor: { charAnchor: 20, source: 'word' },
            erasedAt: '2026-07-21T10:00:05.000Z',
          },
        ],
      },
    )

    await act(ada, 'deck.refineSlide', { deckId, slideId: target })

    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('Photosynthesis rocks (refined)') // 30 chars
    // Anchors stay proportional: 10/20 → 15/30, 20/20 → 30/30.
    expect(t?.drawings?.[0]?.anchor.charAnchor).toBe(15)
    expect(t?.drawings?.[0]?.erasedAnchor?.charAnchor).toBe(30)
  })

  // The per-slide dialog sends what THIS run should do; the lecture's saved
  // settings only apply when it sends nothing.
  describe('with per-run options', () => {
    it('refines only the parts asked for', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')

      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { parts: { text: true, layout: false, imagery: false } },
      })

      // Text without layout: the model is offered only the slide's current
      // layout, so it writes into the slots that slide actually has.
      const offered = refine.mock.calls[0]![0].layoutDescriptors
      expect(offered.map(d => d.type)).toEqual(['content'])
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBe(
        `Refined (level ${env.REFINE_SLIDES_DEFAULT_LEVEL})`,
      )
      expect(t?.layoutType).toBe('content')
      refine.mockRestore()
    })

    it('never calls the model when only imagery is asked for', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { parts: { text: false, layout: false, imagery: true } },
      })

      expect(res.status).toBe(200)
      // Enrichment falls back to the slide's own keywords, so nothing is
      // billed for text that would be discarded.
      expect(refine).not.toHaveBeenCalled()
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBeUndefined() // words untouched
      refine.mockRestore()
    })

    it('applies one slider to both the content and narration passes', async () => {
      const { target } = await seedSlides()
      const gen = registry.get<GenerationProvider>('generation')
      const refine = vi.spyOn(gen, 'refineSlide')
      const narrate = vi.spyOn(gen, 'narrateSlide')

      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { refineTranscript: true, level: 5 },
      })

      expect(refine).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 5 }),
      )
      expect(narrate).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 5 }),
      )
      refine.mockRestore()
      narrate.mockRestore()
    })

    it('skips the content pass when no part is selected', async () => {
      const { target } = await seedSlides()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: {
          parts: { text: false, layout: false, imagery: false },
          refineTranscript: true,
        },
      })

      expect(res.body.refined).toBe(false)
      expect(res.body.narrationUpdated).toBe(true)
      const t = await SlideModel.findById(target)
      expect(t?.caption).toBeUndefined()
    })

    it('identifies speakers from this slide’s own recording and reframes it', async () => {
      const { target, other } = await seedSlides()
      // A recording plus a student turn on the target slide only.
      await DeckModel.updateOne(
        { _id: deckId },
        {
          $push: {
            recordings: {
              sessionId: 'rec-1',
              audioKey: `audio/${deckId}/rec-1.wav`,
              sampleRate: 16_000,
              durationMs: 620_000,
              createdAt: new Date(),
            },
          },
        },
      )
      // The mock diarizer puts speaker 2 (a student) in the 600–620s window.
      await TranscriptSegmentModel.create({
        deckId,
        sessionId: 'rec-1',
        text: 'Is this on the exam?',
        action: 'none',
        slideId: target,
        startMs: 605_000,
        endMs: 610_000,
        words: [{ word: 'Is', startMs: 605_000, endMs: 610_000 }],
      })

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: {
          identifySpeakers: true,
          parts: { text: false, layout: false, imagery: false },
        },
      })

      expect(res.status).toBe(200)
      expect(res.body.reframed).toBe(true)
      // The slide's segment is now tagged, and its narration attributes the
      // student rather than stating it as fact.
      const seg = await TranscriptSegmentModel.findOne({ slideId: target })
      expect(seg?.role).toBe('student')
      const t = await SlideModel.findById(target)
      expect(t?.sourceTranscript).toMatch(/^A student asked:/)
      // Only this slide was touched.
      const o = await SlideModel.findById(other)
      expect(o?.sourceTranscript).toBeUndefined()
    })

    it('reports no reframing when the slide has no retained audio', async () => {
      const { target } = await seedSlides()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: target,
        options: { identifySpeakers: true },
      })
      expect(res.status).toBe(200)
      expect(res.body.reframed).toBe(false)
    })
  })

  /**
   * Breaking one slide up (GEN-4).
   *
   * The instructor grants this in the Refine dialog before the run, so what
   * comes back is a deck that already changed shape — there is no dialog to
   * catch a split nobody wanted. So both directions are checked against the
   * DECK: with permission the parts exist and are ordered, and without it the
   * slide is untouched. The mock provider proposes a split for a slide of
   * three or more bullets, and only when it was allowed to.
   */
  describe('breaking a slide up', () => {
    /** A three-bullet slide (the mock's split trigger) plus one after it. */
    const seedWide = async () => {
      const wide = await SlideModel.create({
        deckId,
        index: 0,
        layoutType: 'list',
        title: 'Stages',
        bullets: ['Absorption', 'Transfer', 'Fixation'],
        sourceTranscript: 'The three stages, as spoken.',
      })
      const after = await SlideModel.create({
        deckId,
        index: 1,
        layoutType: 'content',
        title: 'Summary',
        body: 'One idea',
      })
      await DeckModel.updateOne(
        { _id: deckId },
        { slideOrder: [wide._id.toString(), after._id.toString()] },
      )
      return { wide: wide._id.toString(), after: after._id.toString() }
    }

    it('writes the parts, and reports them for the viewer to show', async () => {
      const { wide, after } = await seedWide()

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: { allowSplit: true },
      })
      expect(res.status).toBe(200)
      // The original kept its id and now holds the first part.
      expect(res.body.slide.id).toBe(wide)
      expect(res.body.split.added).toHaveLength(2)
      expect(res.body.split.reason).toBe('3 separate points')
      expect(res.body.split.slideOrder).toEqual([
        wide,
        res.body.split.added[0].id,
        res.body.split.added[1].id,
        after,
      ])

      const slides = await SlideModel.find({ deckId }).sort({ index: 1 })
      expect(slides.map(s => s.title)).toEqual([
        'Stages (1)',
        'Stages (2)',
        'Stages (3)',
        'Summary',
      ])
      expect(slides.map(s => s.index)).toEqual([0, 1, 2, 3])
    })

    it('gives each part the words the slide was speaking', async () => {
      // A part with no source material would be narrated from its own text,
      // which is not what the instructor said.
      const { wide } = await seedWide()
      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: { allowSplit: true },
      })
      const parts = await SlideModel.find({ deckId, title: /^Stages/ })
      expect(parts).toHaveLength(3)
      for (const part of parts)
        expect(part.sourceTranscript).toContain('The three stages')
    })

    it('leaves the slide whole when the run did not allow it', async () => {
      const { wide } = await seedWide()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: { allowSplit: false },
      })
      expect(res.body.split).toBeUndefined()
      expect(await SlideModel.countDocuments({ deckId })).toBe(2)
    })

    it('is off unless the lecture says otherwise', async () => {
      // The default has to hold with no options at all: a scripted refine, or
      // the kebab before the dialog existed, must not restructure a lecture.
      const { wide } = await seedWide()
      const res = await act(ada, 'deck.refineSlide', { deckId, slideId: wide })
      expect(res.body.split).toBeUndefined()
      expect(await SlideModel.countDocuments({ deckId })).toBe(2)
    })

    it("follows the lecture's saved setting when the run says nothing", async () => {
      const { wide } = await seedWide()
      const saved = await act(ada, 'deck.setRefineSettings', {
        deckId,
        splitEnabled: true,
      })
      expect(saved.body.refineSplitEnabled).toBe(true)

      const res = await act(ada, 'deck.refineSlide', { deckId, slideId: wide })
      expect(res.body.split.added).toHaveLength(2)
    })

    it('this run overrides the saved setting, without changing it', async () => {
      const { wide } = await seedWide()
      await act(ada, 'deck.setRefineSettings', { deckId, splitEnabled: true })

      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: { allowSplit: false },
      })
      expect(res.body.split).toBeUndefined()
      // The lecture keeps the answer it was given in its settings.
      const deck = await DeckModel.findById(deckId)
      expect(deck?.refineSplitEnabled).toBe(true)
    })

    it('does not split a refine that is not reading the words', async () => {
      // Splitting is a claim about a slide's text. A layout/imagery-only pass
      // never looked at it and must not make that claim.
      const { wide } = await seedWide()
      const res = await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: {
          allowSplit: true,
          parts: { text: false, layout: true, imagery: true },
        },
      })
      expect(res.body.split).toBeUndefined()
      expect(await SlideModel.countDocuments({ deckId })).toBe(2)
    })

    it('re-narrates the slide it split, from the part it now holds', async () => {
      const { wide } = await seedWide()
      await act(ada, 'deck.refineSlide', {
        deckId,
        slideId: wide,
        options: { allowSplit: true },
      })
      const first = await SlideModel.findById(wide)
      expect(first?.title).toBe('Stages (1)')
      expect(first?.sourceTranscript).toBeTruthy()
    })
  })

  it('gates on edit access and slide ownership', async () => {
    const { target } = await seedSlides()
    const bob = await registerUser('bob@example.com')
    expect(
      (await act(bob, 'deck.refineSlide', { deckId, slideId: target })).status,
    ).toBe(403)

    // A slide that belongs to a different deck is rejected.
    const other = await act(ada, 'deck.create', {
      projectId: (await act(ada, 'project.create', { title: 'Other' })).body.id,
      title: 'Other lecture',
      templateId: 'classic',
    })
    const stray = await SlideModel.create({
      deckId: other.body.id,
      index: 0,
      layoutType: 'content',
      title: 'Stray',
    })
    expect(
      (
        await act(ada, 'deck.refineSlide', {
          deckId,
          slideId: stray._id.toString(),
        })
      ).status,
    ).toBe(403)
  })
})

/**
 * A refine's content is clamped to its layout's limits before it is stored
 * (GEN-4) — the same protection a live new slide gets from `clampToBudget`,
 * now also applied to the post-lecture Refine pass. Production evidence was
 * slides with 100-160-char bullets against a 65/70-char limit, and layout
 * switches onto boxes the words did not fit: the model is prompted with the
 * limits (the richer layout menu), but never trusted with them.
 */
describe('deck.refineSlide clamps to the layout’s limits (GEN-4)', () => {
  // The deck's default template is "nyu-elegant" (DEFAULT_TEMPLATE_ID):
  // its "list" layout puts the limits on the SLOTS (title maxChars 44,
  // bullets maxItems 5/maxChars 70) rather than on layout `constraints` —
  // exactly the shape budgetsFor/clampToBudget exist to read.
  //
  // GEN-8: this trimming is gated by the lecture's overflow override switch,
  // which now defaults OFF — so each test here turns it explicitly on
  // (writing the field directly rather than through the admin-only action,
  // which this suite has no admin user for).
  beforeEach(async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { $set: { newSlideOverrideOverflow: true } },
    )
  })

  it('trims an over-long title and bullets, and drops bullets past the count', async () => {
    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['one', 'two', 'three'],
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'list',
      slots: {
        title: 'This title definitely runs on for far too many characters', // over the 44-char title budget
        bullets: [
          'this bullet runs on for far longer than the seventy character budget allows it to',
          ...Array.from({ length: 7 }, (_, i) => `bullet ${i}`), // 8 total, over maxItems 5
        ],
      },
    })

    const res = await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
    })
    expect(res.status).toBe(200)

    const t = await SlideModel.findById(target._id)
    expect(t?.title!.length).toBeLessThanOrEqual(44)
    expect(t?.bullets).toHaveLength(5)
    for (const b of t?.bullets ?? []) expect(b.length).toBeLessThanOrEqual(70)
    refine.mockRestore()
  })

  it('clamps a text-only refine against the slide’s OWN layout, not the model’s', async () => {
    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['one'],
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      // The model may echo a different layout, but text-only refine forces
      // the slide's own layout back in before clamping (the code already
      // ignores this layoutType for anything but the budget it clamps to).
      layoutType: 'content',
      slots: {
        bullets: Array.from(
          { length: 10 },
          () =>
            'this bullet has words enough to run well past the seventy character limit',
        ), // over list's 70-char bullets and 5-count cap
      },
    })

    await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
      options: { parts: { text: true, layout: false, imagery: false } },
    })

    const t = await SlideModel.findById(target._id)
    expect(t?.layoutType).toBe('list') // layout untouched, as the option asked
    expect(t?.bullets).toHaveLength(5) // list's maxItems
    for (const b of t?.bullets ?? []) expect(b.length).toBeLessThanOrEqual(70)
    refine.mockRestore()
  })

  it('clamps each part of a split to its own layout’s limits', async () => {
    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content', // maxTitleChars 44, body maxChars 300
      title: 'Stages',
      body: 'Absorption, transfer, then fixation.',
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'content',
      slots: { title: 'Stages', body: 'Absorption, transfer, then fixation.' },
      splitProposal: {
        reason: 'three separate stages',
        parts: [
          {
            layoutType: 'list', // maxItems 5, maxChars 70
            slots: {
              title: 'Absorption',
              bullets: Array.from(
                { length: 8 },
                () =>
                  'a bullet with words enough to run well past the seventy character limit',
              ),
            },
          },
          { layoutType: 'content', slots: { title: 'Transfer', body: 'y' } },
        ],
      },
    })

    await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
      options: { allowSplit: true },
    })

    const parts = await SlideModel.find({ deckId }).sort({ index: 1 })
    expect(parts).toHaveLength(2)
    const withBullets = parts.find(p => p.layoutType === 'list')!
    expect(withBullets.bullets).toHaveLength(5)
    for (const b of withBullets.bullets ?? [])
      expect(b.length).toBeLessThanOrEqual(70)
    refine.mockRestore()
  })

  it('keeps the current layout when the switch would need a trim the layout-only pass may not make', async () => {
    // Two layouts with the SAME slots (so layoutDisplaysContent alone would
    // allow the switch), but the target's body budget is far too small for
    // what this slide already holds — the layout-only fit gate this slice
    // adds.
    const owner = await UserModel.findOne({ email: 'ada@example.com' })
    const template = await TemplateModel.create({
      ownerId: owner!._id,
      name: 'Two bodies',
      permalinkSlug: `two-bodies-${Date.now()}`,
      theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
      layouts: [
        {
          type: 'wide',
          label: 'Wide',
          purpose: 'a roomy body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 300 },
          ],
          elementPositions: {},
        },
        {
          type: 'narrow',
          label: 'Narrow',
          purpose: 'a tight body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 40 },
          ],
          elementPositions: {},
        },
        {
          type: 'whiteboard',
          label: 'Whiteboard',
          purpose: 'a blank slate',
          slots: [],
          elementPositions: {},
        },
      ],
      visibility: 'private',
    })
    const project = await act(ada, 'project.create', { title: 'Two bodies' })
    const created = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Lecture',
      templateId: String(template._id),
    })
    const customDeckId = created.body.id as string
    await DeckModel.updateOne(
      { _id: customDeckId },
      {
        $set: {
          templateId: String(template._id),
          newSlideOverrideOverflow: true, // GEN-8: trimming defaults off
        },
        $unset: { templateVersionId: '' },
      },
    )
    const target = await SlideModel.create({
      deckId: customDeckId,
      index: 0,
      layoutType: 'wide',
      title: 'Long body',
      body: 'y'.repeat(200), // fits "wide" (300), far over "narrow" (40)
    })

    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'narrow',
      slots: {},
    })

    await act(ada, 'deck.refineSlide', {
      deckId: customDeckId,
      slideId: target._id.toString(),
      options: { parts: { text: false, layout: true, imagery: false } },
    })

    const t = await SlideModel.findById(target._id)
    // The switch is refused: the body would need trimming to fit "narrow",
    // and a layout-only refine must not change the words.
    expect(t?.layoutType).toBe('wide')
    expect(t?.body).toBe('y'.repeat(200))
    refine.mockRestore()
  })
})

/**
 * GEN-8: the overflow switch (and with it, Refine's trimming) now defaults
 * off. Unlike the "turns off" tests below, these never call
 * deck.setNewSlideOverrides at all — a freshly-created deck's field is
 * genuinely absent, not explicitly set — so a regression that flips
 * reconcile.ts's own fallback back to trimming (rather than reading
 * NEW_SLIDE_OVERRIDE_DEFAULTS.overflow) would still show green everywhere
 * else and only fail here.
 */
describe('an unset overflow switch leaves Refine untrimmed by default (GEN-8)', () => {
  it('stores over-long bullets untrimmed with the switch left unset', async () => {
    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['one', 'two', 'three'],
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'list',
      slots: {
        title: 'This title definitely runs on for far too many characters',
        bullets: [
          'this bullet runs on for far longer than the seventy character budget allows it to',
          ...Array.from({ length: 7 }, (_, i) => `bullet ${i}`), // 8 total
        ],
      },
    })

    const res = await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
    })
    expect(res.status).toBe(200)

    const t = await SlideModel.findById(target._id)
    // Untrimmed: the over-long title survives, all 8 bullets survive, and at
    // least one is over the layout's 70-char bullet budget.
    expect(t?.title!.length).toBeGreaterThan(44)
    expect(t?.bullets).toHaveLength(8)
    expect(t?.bullets?.some(b => b.length > 70)).toBe(true)
    refine.mockRestore()
  })

  it('lets a layout-only switch through unset, even when the target does not fit (fit gate skipped)', async () => {
    const owner = await UserModel.findOne({ email: 'ada@example.com' })
    const template = await TemplateModel.create({
      ownerId: owner!._id,
      name: 'Two bodies (unset)',
      permalinkSlug: `two-bodies-unset-${Date.now()}`,
      theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
      layouts: [
        {
          type: 'wide',
          label: 'Wide',
          purpose: 'a roomy body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 300 },
          ],
          elementPositions: {},
        },
        {
          type: 'narrow',
          label: 'Narrow',
          purpose: 'a tight body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 40 },
          ],
          elementPositions: {},
        },
        {
          type: 'whiteboard',
          label: 'Whiteboard',
          purpose: 'a blank slate',
          slots: [],
          elementPositions: {},
        },
      ],
      visibility: 'private',
    })
    const project = await act(ada, 'project.create', { title: 'Two bodies' })
    const created = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Lecture',
      templateId: String(template._id),
    })
    const customDeckId = created.body.id as string
    // The override is left unset here — no deck.setNewSlideOverrides call —
    // this is the default-off state, not an admin experiment.
    await DeckModel.updateOne(
      { _id: customDeckId },
      {
        $set: { templateId: String(template._id) },
        $unset: { templateVersionId: '' },
      },
    )
    const target = await SlideModel.create({
      deckId: customDeckId,
      index: 0,
      layoutType: 'wide',
      title: 'Long body',
      body: 'y'.repeat(200), // fits "wide" (300), far over "narrow" (40)
    })

    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'narrow',
      slots: {},
    })

    await act(ada, 'deck.refineSlide', {
      deckId: customDeckId,
      slideId: target._id.toString(),
      options: { parts: { text: false, layout: true, imagery: false } },
    })

    const t = await SlideModel.findById(target._id)
    // The switch is taken even though "narrow" cannot hold the body without
    // a trim: unset defaults to off, so the fit-first gate is skipped.
    expect(t?.layoutType).toBe('narrow')
    expect(t?.body).toBe('y'.repeat(200))
    refine.mockRestore()
  })
})

/**
 * GEN-8: the lecture's overflow override switch also governs this trimming.
 * Off means Refine no longer protects the layout's limits — an admin
 * experiment, not something an ordinary owner can reach.
 */
describe('the overflow override turns off Refine’s box-limit trimming (GEN-8)', () => {
  const ADMIN_EMAIL = 'admin@example.com'

  beforeAll(() => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL
  })
  afterAll(() => {
    delete process.env.ADMIN_EMAILS
  })

  it('stores over-long bullets untrimmed when the override is off', async () => {
    const admin = await registerUser(ADMIN_EMAIL)
    const off = await act(admin, 'deck.setNewSlideOverrides', {
      deckId,
      overflow: false,
    })
    expect(off.status).toBe(200)

    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['one', 'two', 'three'],
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'list',
      slots: {
        title: 'This title definitely runs on for far too many characters',
        bullets: [
          'this bullet runs on for far longer than the seventy character budget allows it to',
          ...Array.from({ length: 7 }, (_, i) => `bullet ${i}`), // 8 total
        ],
      },
    })

    const res = await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
    })
    expect(res.status).toBe(200)

    const t = await SlideModel.findById(target._id)
    // Untrimmed: the over-long title survives, all 8 bullets survive, and at
    // least one is over the layout's 70-char bullet budget.
    expect(t?.title!.length).toBeGreaterThan(44)
    expect(t?.bullets).toHaveLength(8)
    expect(t?.bullets?.some(b => b.length > 70)).toBe(true)
    refine.mockRestore()
  })

  it('lets a layout-only switch through even when the target does not fit (fit gate skipped)', async () => {
    const admin = await registerUser(ADMIN_EMAIL)
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })

    const owner = await UserModel.findOne({ email: 'ada@example.com' })
    const template = await TemplateModel.create({
      ownerId: owner!._id,
      name: 'Two bodies (override)',
      permalinkSlug: `two-bodies-override-${Date.now()}`,
      theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
      layouts: [
        {
          type: 'wide',
          label: 'Wide',
          purpose: 'a roomy body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 300 },
          ],
          elementPositions: {},
        },
        {
          type: 'narrow',
          label: 'Narrow',
          purpose: 'a tight body',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body', maxChars: 40 },
          ],
          elementPositions: {},
        },
        {
          type: 'whiteboard',
          label: 'Whiteboard',
          purpose: 'a blank slate',
          slots: [],
          elementPositions: {},
        },
      ],
      visibility: 'private',
    })
    const project = await act(ada, 'project.create', { title: 'Two bodies' })
    const created = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Lecture',
      templateId: String(template._id),
    })
    const customDeckId = created.body.id as string
    await DeckModel.updateOne(
      { _id: customDeckId },
      {
        $set: { templateId: String(template._id) },
        $unset: { templateVersionId: '' },
      },
    )
    await act(admin, 'deck.setNewSlideOverrides', {
      deckId: customDeckId,
      overflow: false,
    })
    const target = await SlideModel.create({
      deckId: customDeckId,
      index: 0,
      layoutType: 'wide',
      title: 'Long body',
      body: 'y'.repeat(200), // fits "wide" (300), far over "narrow" (40)
    })

    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'narrow',
      slots: {},
    })

    await act(ada, 'deck.refineSlide', {
      deckId: customDeckId,
      slideId: target._id.toString(),
      options: { parts: { text: false, layout: true, imagery: false } },
    })

    const t = await SlideModel.findById(target._id)
    // The switch is taken even though "narrow" cannot hold the body without
    // a trim: with the override off, the fit-first gate is skipped.
    expect(t?.layoutType).toBe('narrow')
    expect(t?.body).toBe('y'.repeat(200))
    refine.mockRestore()
  })

  it('stores over-long bullets untrimmed on a TEXT-ONLY refine (layout off)', async () => {
    // This exercises the `want.text` branch alone (reconcile.ts ~688-697),
    // distinct from the combined `want.text && want.layout` branch the first
    // test above covers — each substitutes `clampToBudget` independently.
    const admin = await registerUser(ADMIN_EMAIL)
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })

    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'list',
      title: 'Stages',
      bullets: ['one'],
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'content', // ignored for the clamp; text-only keeps the slide's own layout
      slots: {
        bullets: Array.from(
          { length: 10 }, // over list's 5-item cap
          () =>
            'this bullet has words enough to run well past the seventy character limit',
        ),
      },
    })

    await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
      options: { parts: { text: true, layout: false, imagery: false } },
    })

    const t = await SlideModel.findById(target._id)
    expect(t?.layoutType).toBe('list') // layout untouched, as the option asked
    expect(t?.bullets).toHaveLength(10) // untrimmed: over list's 5-item cap
    expect(t?.bullets?.some(b => b.length > 70)).toBe(true)
    refine.mockRestore()
  })

  it('stores an over-long split part untrimmed when Refine applies the split', async () => {
    // Exercises `splitSlideIntoParts`'s clamp (reconcile.ts ~554-557) via the
    // Refine call path, which passes `trimToBudget: false` when the switch
    // is off — distinct from the manual deck.splitSlide path, which does not.
    const admin = await registerUser(ADMIN_EMAIL)
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })

    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Stages',
      body: 'Absorption, transfer, then fixation.',
    })
    const gen = registry.get<GenerationProvider>('generation')
    const refine = vi.spyOn(gen, 'refineSlide').mockResolvedValueOnce({
      layoutType: 'content',
      slots: { title: 'Stages', body: 'Absorption, transfer, then fixation.' },
      splitProposal: {
        reason: 'three separate stages',
        parts: [
          {
            layoutType: 'list', // maxItems 5, maxChars 70
            slots: {
              title: 'Absorption',
              bullets: Array.from(
                { length: 8 }, // over the 5-item cap
                () =>
                  'a bullet with words enough to run well past the seventy character limit',
              ),
            },
          },
          { layoutType: 'content', slots: { title: 'Transfer', body: 'y' } },
        ],
      },
    })

    await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target._id.toString(),
      options: { allowSplit: true },
    })

    const parts = await SlideModel.find({ deckId }).sort({ index: 1 })
    expect(parts).toHaveLength(2)
    const withBullets = parts.find(p => p.layoutType === 'list')!
    // Untrimmed: all 8 bullets survive, over the 5-item cap and 70-char limit.
    expect(withBullets.bullets).toHaveLength(8)
    expect(withBullets.bullets?.some(b => b.length > 70)).toBe(true)
    refine.mockRestore()
  })

  it('manual deck.splitSlide still trims an over-long part even with the switch off', async () => {
    // The switch governs REFINE's trimming only; the hand-driven/MCP split
    // action is not an update->new override and must keep trimming
    // regardless (splitSlideIntoParts's `opts.trimToBudget` default).
    const admin = await registerUser(ADMIN_EMAIL)
    await act(admin, 'deck.setNewSlideOverrides', { deckId, overflow: false })

    const target = await SlideModel.create({
      deckId,
      index: 0,
      layoutType: 'content',
      title: 'Stages',
      body: 'Absorption, transfer, then fixation.',
    })

    const res = await act(ada, 'deck.splitSlide', {
      deckId,
      slideId: target._id.toString(),
      parts: [
        {
          layoutType: 'list', // maxItems 5, maxChars 70
          slots: {
            title: 'Absorption',
            bullets: Array.from(
              { length: 8 }, // over the 5-item cap
              () =>
                'a bullet with words enough to run well past the seventy character limit',
            ),
          },
        },
        { layoutType: 'content', slots: { title: 'Transfer', body: 'y' } },
      ],
    })
    expect(res.status).toBe(200)

    const parts = await SlideModel.find({ deckId }).sort({ index: 1 })
    const withBullets = parts.find(p => p.layoutType === 'list')!
    // Trimmed: the manual split path always clamps, override or not.
    expect(withBullets.bullets).toHaveLength(5)
    for (const b of withBullets.bullets ?? [])
      expect(b.length).toBeLessThanOrEqual(70)
  })
})

/**
 * The transcript editor's "Refine" button runs the same narration pass, at the
 * same strength, but hands the text back instead of writing it.
 */
describe('deck.refineSlideTranscript', () => {
  it('returns the refined narration without touching the slide', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne(
      { _id: target },
      { sourceTranscript: 'The original spoken words.' },
    )

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(200)
    expect(res.body.transcript).toBe('The original spoken words. (refined)')
    // Nothing is saved until the user accepts it in the editor.
    expect(res.body.slide).toBeUndefined()
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('The original spoken words.')
    // And the content pass never runs — this refines the narration only.
    expect(t?.caption).toBeUndefined()
  })

  it('writes it, and re-anchors whiteboard marks, when asked to save', async () => {
    const { target } = await seedSlides()
    await SlideModel.updateOne(
      { _id: target },
      {
        sourceTranscript: 'Photosynthesis rocks', // 20 chars → 30 refined
        drawings: [
          {
            id: 'stroke-1',
            tool: 'pen',
            color: '#1e293b',
            thickness: 0.01,
            points: [{ x: 0.2, y: 0.3 }],
            startedAt: '2026-07-21T10:00:00.000Z',
            endedAt: '2026-07-21T10:00:01.000Z',
            anchor: { charAnchor: 10, source: 'word' },
          },
        ],
      },
    )

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
      save: true,
    })
    expect(res.body.slide.sourceTranscript).toBe(
      'Photosynthesis rocks (refined)',
    )
    const t = await SlideModel.findById(target)
    expect(t?.sourceTranscript).toBe('Photosynthesis rocks (refined)')
    // Proportional re-anchor, as on every other transcript rewrite: 10/20 → 15/30.
    expect(t?.drawings?.[0]?.anchor.charAnchor).toBe(15)
  })

  // The strength comes from the lecture's transcript slider, else the server
  // default — there is no project tier for refine settings.
  it("refines at the lecture's saved transcript level, else the default", async () => {
    const { target } = await seedSlides()
    const gen = registry.get<GenerationProvider>('generation')
    const narrate = vi.spyOn(gen, 'narrateSlide')

    await act(ada, 'deck.refineSlideTranscript', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: env.REFINE_TRANSCRIPT_DEFAULT_LEVEL }),
    )

    await act(ada, 'deck.setRefineSettings', { deckId, transcriptLevel: 4 })
    await act(ada, 'deck.refineSlideTranscript', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 4 }),
    )

    // The same level the kebab "Refine this slide" narrates at.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    expect(narrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 4 }),
    )
    narrate.mockRestore()
  })

  it('frames the narration as a question for a student slide', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })

    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.body.transcript).toMatch(/^A student asked:/)
  })

  it('always produces a rewrite, even when the background pass would skip', async () => {
    const { target } = await seedSlides()
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is this on the exam?',
      action: 'none',
      slideId: target,
      role: 'student',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Is', startMs: 0, endMs: 1000 }],
    })
    // A full refine records the idempotency hash, which makes the background
    // pass skip this slide next time.
    await act(ada, 'deck.refineSlide', { deckId, slideId: target })
    const second = await act(ada, 'deck.refineSlide', {
      deckId,
      slideId: target,
    })
    expect(second.body.narrationUpdated).toBe(false)

    // The user clicked Refine, so they get text back regardless.
    const res = await act(ada, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(200)
    expect(res.body.transcript).toMatch(/^A student asked:/)
  })

  it('gates on edit access', async () => {
    const { target } = await seedSlides()
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'deck.refineSlideTranscript', {
      deckId,
      slideId: target,
    })
    expect(res.status).toBe(403)
  })
})
