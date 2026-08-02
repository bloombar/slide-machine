/**
 * Integration tests for narration metering (BILL-3) over the real TTS route,
 * with the mock synthesizer standing in for the paid API.
 *
 * The route is where the owner-pays rule is actually decided, so these cover
 * the parts a unit test cannot: that a listener spends the owner's audience
 * allowance rather than the author's, that cached audio keeps playing after a
 * cap is reached, and that the cheapest tier can still use a premium voice.
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
import { Types } from 'mongoose'

// Mock synthesizer, and the premium default voice this deployment ships, so
// the premium allowance is what the default path actually spends.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TTS_PROVIDER: 'mock', TTS_DEFAULT_VOICE: 'leo' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { UsageRecordModel } from '../../src/models/usage-record'
import { recordUsage, usedThisPeriod, capFor } from '../../src/billing/usage'

const server = createApp().listen(0)

let ownerId: string
let listenerId: string
let ownerToken: string
let listenerToken: string
let deckId: string

const tokenFor = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) throw new Error(`registration failed: ${res.status}`)
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const speak = (token: string, slideId: string) =>
  request(server)
    .post(`/api/slides/${slideId}/tts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'content' })

/** A slide whose words are unique per test, so every run starts on a cache
 * miss — the audio cache is on disk and outlives the database. */
const makeSlide = async (): Promise<string> => {
  const slide = await SlideModel.create({
    deckId: new Types.ObjectId(deckId),
    index: 0,
    layoutType: 'content',
    title: 'Osmosis',
    body: `Water moves ${Math.random().toString(36).slice(2)}`,
  })
  return slide._id.toString()
}

const setTier = (userId: string, planTier: string) =>
  UserModel.updateOne({ _id: userId }, { planTier })

/** Picks the lecture's voice, which is what decides standard vs premium. */
const setVoice = (voice: string) =>
  act(ownerToken, 'deck.setTtsVoice', { deckId, voice })

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), UsageRecordModel.init()])
})

afterAll(async () => {
  server.close()
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ownerToken = await tokenFor('ada@example.com')
  listenerToken = await tokenFor('bob@example.com')
  ownerId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  listenerId = (await UserModel.findOne({
    email: 'bob@example.com',
  }))!._id.toString()

  const project = await act(ownerToken, 'project.create', { title: 'Bio' })
  const deck = await act(ownerToken, 'deck.create', {
    projectId: project.body.id,
    title: 'L1',
    templateId: 'classic',
  })
  deckId = deck.body.id
  // A standard voice by default, so the common cases exercise the everyday
  // allowance; the premium case opts in explicitly.
  await setVoice('emma')
})

describe('narration metering', () => {
  it('charges the author’s own allowance when they synthesize', async () => {
    const slideId = await makeSlide()
    const res = await speak(ownerToken, slideId)

    expect(res.status).toBe(200)
    expect(await usedThisPeriod(ownerId, 'ttsCharacters')).toBeGreaterThan(0)
    expect(await usedThisPeriod(ownerId, 'audienceTtsCharacters')).toBe(0)
  })

  it('charges a listener’s playback to the deck owner, not the listener', async () => {
    await setTier(ownerId, 'pro')
    const slideId = await makeSlide()
    const res = await speak(listenerToken, slideId)

    expect(res.status).toBe(200)
    // The owner pays, out of the audience allowance rather than their own.
    expect(
      await usedThisPeriod(ownerId, 'audienceTtsCharacters'),
    ).toBeGreaterThan(0)
    expect(await usedThisPeriod(ownerId, 'ttsCharacters')).toBe(0)
    // The listener's account is untouched: they have no plan in this.
    expect(await usedThisPeriod(listenerId, 'audienceTtsCharacters')).toBe(0)
  })

  it('does not charge again for audio that is already cached', async () => {
    const slideId = await makeSlide()
    await speak(ownerToken, slideId)
    const afterFirst = await usedThisPeriod(ownerId, 'ttsCharacters')

    const second = await speak(ownerToken, slideId)
    expect(second.status).toBe(200)
    expect(await usedThisPeriod(ownerId, 'ttsCharacters')).toBe(afterFirst)
  })

  it('keeps serving cached audio after the allowance is gone', async () => {
    // The rule that makes a hard block defensible: students never lose access
    // to material their instructor already paid to produce.
    const slideId = await makeSlide()
    await speak(ownerToken, slideId)
    await recordUsage(
      ownerId,
      'ttsCharacters',
      capFor('free', 'ttsCharacters')!,
    )

    const replay = await speak(ownerToken, slideId)
    expect(replay.status).toBe(200)
    expect(replay.body.url).toMatch(/\.wav$/)
  })

  it('402s an author whose narration allowance is spent', async () => {
    await recordUsage(
      ownerId,
      'ttsCharacters',
      capFor('free', 'ttsCharacters')!,
    )
    const res = await speak(ownerToken, await makeSlide())

    expect(res.status).toBe(402)
    expect(res.body.error?.code).toBe('plan_limit_exceeded')
    expect(res.body.error?.message).toMatch(/used all of this billing period/i)
  })

  it('402s a listener without telling them whose limit it was', async () => {
    await recordUsage(
      ownerId,
      'audienceTtsCharacters',
      capFor('free', 'audienceTtsCharacters')!,
    )
    const res = await speak(listenerToken, await makeSlide())

    expect(res.status).toBe(402)
    expect(res.body.error?.message).toBe(
      'Narration isn’t available for this slide yet.',
    )
    expect(res.body.error?.message).not.toMatch(/plan|billing|instructor/i)
  })

  it('lets the cheapest tier use a premium voice, on its own allowance', async () => {
    // Every plan offers every voice (BILL-1); Free just gets fewer premium
    // characters. A free user picking Leo must hear Leo.
    await setVoice('leo')
    const res = await speak(ownerToken, await makeSlide())

    expect(res.status).toBe(200)
    expect(
      await usedThisPeriod(ownerId, 'ttsPremiumCharacters'),
    ).toBeGreaterThan(0)
    // Charged to the premium budget only — the two never cross-subsidize.
    expect(await usedThisPeriod(ownerId, 'ttsCharacters')).toBe(0)
  })

  it('still narrates with a standard voice once premium is spent', async () => {
    // The allowances are independent, so running out of the expensive one
    // costs the user quality, never the feature.
    await setVoice('leo')
    await recordUsage(
      ownerId,
      'ttsPremiumCharacters',
      capFor('free', 'ttsPremiumCharacters')!,
    )
    expect((await speak(ownerToken, await makeSlide())).status).toBe(402)

    await setVoice('emma')
    expect((await speak(ownerToken, await makeSlide())).status).toBe(200)
  })

  it('counts the characters the synthesizer was actually billed for', async () => {
    const slide = await SlideModel.create({
      deckId: new Types.ObjectId(deckId),
      index: 1,
      layoutType: 'content',
      title: 'Cells',
      body: `Overview ${Math.random().toString(36).slice(2)}`,
    })
    const res = await speak(ownerToken, slide._id.toString())

    expect(res.status).toBe(200)
    // The mock bills the plain text, so the count matches the spoken words
    // rather than a guess made by the route.
    const spoken = `Cells. ${slide.body}`
    expect(await usedThisPeriod(ownerId, 'ttsCharacters')).toBe(spoken.length)
  })
})
