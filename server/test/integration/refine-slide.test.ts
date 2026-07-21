/**
 * Integration test for the single-slide "Refine this slide" action
 * (deck.refineSlide, GEN-4): it refines one slide using the lecture's persisted
 * Refine settings (which passes are on + their levels), leaves every other
 * slide untouched, keeps TTS narration in-line, protects hand-edited slides,
 * and gates on edit access. MongoDB real; mock providers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
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
