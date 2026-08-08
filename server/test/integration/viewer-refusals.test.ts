/**
 * A viewer may read a lecture and may not change it (SHARE-1).
 *
 * One case per family of actions, deliberately. The suite is thorough on
 * owner-versus-stranger but thin on editor-versus-viewer, which is exactly
 * the gap a mis-transcribed access policy would fall into: writing
 * `deckViewer` where the rule was `deckEditor` opens every one of these to
 * someone who was only ever meant to read, and no existing test would notice.
 *
 * Written before the TECH-14 migration touches these actions, so it pins the
 * behaviour that must survive it rather than describing the result.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { act, registerUser, startServer } from './helpers/actions'

const server = startServer()
afterAll(() => server.close())

let ada: string
let cleo: string
let deckId: string
let slideId: string

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
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser(server, 'ada@example.com')
  cleo = await registerUser(server, 'cleo@example.com')

  const project = await act(server, ada, 'project.create', { title: 'Bio' })
  const deck = await act(server, ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
  })
  deckId = deck.body.id

  // The slide is written directly rather than spoken into being through
  // session.phrase. Generating one leaves background work running past the
  // response, which then writes into a lecture the next test's wipe has
  // already removed — and a fixture for an access test should not depend on
  // the generation pipeline at all.
  const slide = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    slots: {},
  })
  slideId = slide._id.toString()
  await DeckModel.updateOne({ _id: deckId }, { slideOrder: [slide._id] })

  // Cleo may read this lecture and nothing more.
  await act(server, ada, 'deck.share', {
    deckId,
    email: 'cleo@example.com',
    role: 'viewer',
  })
})

describe('a viewer may read the lecture', () => {
  it('reads the lecture itself, slides and all', async () => {
    const res = await act(server, cleo, 'deck.get', { deckId })
    expect(res.status).toBe(200)
    expect(res.body.canEdit).toBe(false)
  })

  // slide.get is deliberately NOT part of that: it serves the editing
  // surface, letting the client pick up asynchronously-enriched images
  // (IMG-1). A reader reaches the same content through the lecture.
  it('is refused the per-slide editing read', async () => {
    expect((await act(server, cleo, 'slide.get', { slideId })).status).toBe(403)
  })
})

describe('a viewer may not change it', () => {
  const refused = async (name: string, input: object) => {
    const res = await act(server, cleo, name, input)
    expect(res.status).toBe(403)
    return res
  }

  it('cannot edit slide content', async () => {
    await refused('slide.editContent', { slideId, title: 'Mine now' })
  })

  it('cannot delete a slide', async () => {
    await refused('slide.delete', { slideId })
  })

  it('cannot change a slide layout', async () => {
    await refused('slide.setLayout', { slideId, layoutType: 'title-only' })
  })

  it('cannot edit the spoken transcript', async () => {
    await refused('slide.editTranscript', { slideId, transcript: 'no' })
  })

  it('cannot append to the lecture', async () => {
    await refused('slide.add', { deckId })
  })

  it('cannot reorder the slides', async () => {
    await refused('deck.reorderSlides', { deckId, slideOrder: [slideId] })
  })

  it('cannot speak into it', async () => {
    await refused('session.phrase', { deckId, phrase: 'not mine to add' })
  })

  it('cannot start a refine run', async () => {
    await refused('deck.refine', { deckId })
  })

  it('cannot reformat it', async () => {
    await refused('deck.reformat', { deckId })
  })

  it('cannot export it', async () => {
    await refused('export.download', { deckId, format: 'yaml' })
  })

  it('cannot rename it', async () => {
    await refused('deck.rename', { deckId, title: 'Mine now' })
  })

  it('cannot change who else may see it', async () => {
    await refused('deck.share', {
      deckId,
      email: 'ada@example.com',
      role: 'editor',
    })
  })

  it('cannot delete it', async () => {
    await refused('deck.delete', { deckId })
  })

  // Connected first, so the refusal is unambiguously about the lecture
  // rather than about the account not being set up for Google.
  it('cannot publish a quiz from it', async () => {
    await act(server, cleo, 'quiz.connectGoogle')
    await refused('quiz.publish', { deckId, driveFolderId: 'root' })
  })

  it('cannot manage its seed material', async () => {
    await refused('seedAsset.list', { deckId })
  })
})

/**
 * The ordering TECH-14 exists to fix: a metered action must settle access
 * before it consults the plan. Otherwise someone with no rights to a lecture
 * learns about their billing instead of being refused — and, worse, an action
 * had to go unmetered to avoid saying so (slide.regenerateTranscript did).
 */
describe('access is settled before the plan is', () => {
  it('refuses a viewer at an exhausted cap with 403, not 402', async () => {
    // Spend the whole transcription allowance for cleo's own account, so a
    // meter-first pipeline would answer 402 here.
    await UserModel.updateOne(
      { email: 'cleo@example.com' },
      { planTier: 'free' },
    )
    await UsageRecordModel.create({
      userId: (await UserModel.findOne({ email: 'cleo@example.com' }))!._id,
      period: new Date().toISOString().slice(0, 7),
      metric: 'sttMinutes',
      used: 1_000_000,
    })

    const res = await act(server, cleo, 'slide.regenerateTranscript', {
      slideId,
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  // The same order, for the family that meters AI generation rather than
  // transcription — most of the metered population.
  it.each(['deck.refine', 'deck.reformat', 'session.phrase'])(
    'refuses a viewer of %s at an exhausted AI cap with 403, not 402',
    async name => {
      await UsageRecordModel.create({
        userId: (await UserModel.findOne({ email: 'cleo@example.com' }))!._id,
        period: new Date().toISOString().slice(0, 7),
        metric: 'aiTokens',
        used: 100_000_000,
      })

      const res = await act(server, cleo, name, { deckId, phrase: 'no' })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
    },
  )

  // ...and the cap is genuinely enforced for someone who MAY edit, which it
  // was not while the hook had to stay off.
  it('still refuses an editor at an exhausted cap with 402', async () => {
    await UsageRecordModel.create({
      userId: (await UserModel.findOne({ email: 'ada@example.com' }))!._id,
      period: new Date().toISOString().slice(0, 7),
      metric: 'sttMinutes',
      used: 1_000_000,
    })

    const res = await act(server, ada, 'slide.regenerateTranscript', {
      slideId,
    })
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('plan_limit_exceeded')
  })
})
