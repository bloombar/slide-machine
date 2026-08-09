/**
 * Integration tests for narration in the translated language (PLAY-3):
 * POST /api/slides/:slideId/tts with a `locale`.
 *
 * Needs both mocks at once — the mock TTS adapter (silent WAV, so the whole
 * synthesize → store → serve path runs offline) and the mock translation
 * adapter (which tags each segment `[<locale>]`) — which is why this lives
 * apart from tts.test.ts and translation.test.ts rather than inside either.
 *
 * The requirement's substance is in three places: the words spoken are the
 * lecturer's own, translated; the two fingerprints in one cache entry are
 * independent, so editing a transcript and editing a slide each re-pay for
 * only their own half; and nothing about the audio cache is translation-aware.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import type {
  Locale,
  TranslationProvider,
  TtsProvider,
} from '@slide-machine/shared'

// Force the mock TTS adapter (no paid API) and enable Gemini narration, the
// way tts.test.ts does. Translation is already pinned to `mock` for every
// suite in vitest.config.ts.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TTS_PROVIDER: 'mock', GEMINI_API_KEY: 'test-key' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { registry } from '../../src/providers/registry'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SlideTranslationModel } from '../../src/models/slide-translation'
import { TtsObjectModel } from '../../src/models/tts-object'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { capFor, periodKeyFor, usedThisPeriod } from '../../src/billing/usage'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) throw new Error(`registration failed: ${res.status}`)
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Speak a slide, optionally in another language. */
const speak = (
  token: string,
  slideId: string,
  body: { mode?: string; locale?: string; text?: string } = {},
) =>
  request(server)
    .post(`/api/slides/${slideId}/tts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'transcript', ...body })

/** Counts translation-provider calls for the duration of one assertion. */
const countingProvider = () => {
  const provider = registry.get<TranslationProvider>('translation')
  const original = provider.translate.bind(provider)
  let calls = 0
  provider.translate = async input => {
    calls += 1
    return original(input)
  }
  return {
    get calls() {
      return calls
    },
    restore: () => {
      provider.translate = original
    },
  }
}

/** A Gemini narration reply for the transcript-less case. */
const narrationReply = (text = 'Une narration parlée.') => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
})

/** The cached entry for the slide in one locale. */
const entryFor = async (locale: Locale) =>
  (await SlideTranslationModel.findOne({ deckId, locale }))?.perSlide?.get(
    slideId,
  )

let ada: string
let adaId: string
let byron: string
let deckId: string
let slideId: string
/** Unique per test, so every run starts on a cache miss — the audio cache is
 * on disk and outlives the database. */
let transcript: string
let title: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SlideTranslationModel.init(),
    TtsObjectModel.init(),
  ])
})
afterAll(async () => await disconnectMongo())
afterEach(() => vi.unstubAllGlobals())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    SlideTranslationModel.deleteMany({}),
    TtsObjectModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  byron = await registerUser('byron@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  const nonce = Math.random().toString(36).slice(2)
  title = `Standing waves ${nonce}`
  transcript = `A standing wave has nodes where nothing moves ${nonce}.`
  const slide = await SlideModel.create({
    deckId: new Types.ObjectId(deckId),
    index: 0,
    layoutType: 'content',
    title,
    body: 'A wave that stays in place.',
    sourceTranscript: transcript,
  })
  slideId = slide._id.toString()
})

describe('speaking a deck in the language it is being read in', () => {
  it('speaks the lecturer’s own words, translated', async () => {
    const res = await speak(ada, slideId, { locale: 'fr' })
    expect(res.status).toBe(200)
    expect(res.body.url).toBeTruthy()

    const entry = await entryFor('fr')
    expect(entry?.narration).toBe(`[fr] ${transcript}`)
    expect(entry?.narrationHash).toEqual(expect.any(String))
  })

  it('narrates as before when the deck is read in its own language', async () => {
    const counter = countingProvider()
    try {
      const plain = await speak(ada, slideId)
      const original = await speak(ada, slideId, { locale: 'en' })
      // Asking for the language it already speaks is a no-op, not an error:
      // same audio, and nothing translated.
      expect(original.status).toBe(200)
      expect(original.body.url).toBe(plain.body.url)
      expect(counter.calls).toBe(0)
      expect(await SlideTranslationModel.countDocuments({})).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('replays a translated narration for free', async () => {
    const first = await speak(ada, slideId, { locale: 'fr' })
    const counter = countingProvider()
    try {
      const second = await speak(ada, slideId, { locale: 'fr' })
      expect(second.body.url).toBe(first.body.url)
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('speaks different audio in each language', async () => {
    await UserModel.updateOne({ _id: adaId }, { planTier: 'pro' })
    const fr = await speak(ada, slideId, { locale: 'fr' })
    const es = await speak(ada, slideId, { locale: 'es' })
    const en = await speak(ada, slideId)
    expect(new Set([fr.body.url, es.body.url, en.body.url]).size).toBe(3)
  })

  it('rejects a language it does not support', async () => {
    expect((await speak(ada, slideId, { locale: 'de' })).status).toBe(400)
  })

  it('never translates an unsaved preview', async () => {
    // A preview speaks exactly the words the editor typed, and a translated
    // view is read-only anyway — so a locale on this path is ignored.
    const counter = countingProvider()
    try {
      const res = await speak(ada, slideId, {
        locale: 'fr',
        text: 'Des mots que je viens de taper.',
      })
      expect(res.status).toBe(200)
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
  })
})

describe('a slide nobody narrated', () => {
  beforeEach(async () => {
    await SlideModel.updateOne(
      { _id: slideId },
      { $unset: { sourceTranscript: '' } },
    )
  })

  it('is narrated from its translated content', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      void init
      return narrationReply()
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await speak(ada, slideId, { locale: 'fr' })
    expect(res.status).toBe(200)
    expect(res.body.url).toBeTruthy()

    // Gemini was asked to narrate the FRENCH text, in French — not to narrate
    // the author's English and hope for the best.
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain(`[fr] ${title}`)
    expect(prompt).toContain('fr-FR')
  })

  it('says nothing for a slide with no words at all', async () => {
    const blank = await SlideModel.create({
      deckId: new Types.ObjectId(deckId),
      index: 1,
      layoutType: 'content',
    })
    const res = await speak(ada, blank._id.toString(), { locale: 'fr' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: null, marks: [] })
  })

  it('leaves the other slides’ translations alone', async () => {
    // The trap: `translateSlides` writes `perSlide` from the slides it is
    // handed and drops the rest, so narrating one slide must not evict its
    // neighbours' cached content.
    const second = await SlideModel.create({
      deckId: new Types.ObjectId(deckId),
      index: 1,
      layoutType: 'content',
      title: 'Antinodes',
    })
    await request(server)
      .post(
        `/api/decks/${(await DeckModel.findById(deckId))!.permalinkSlug}/translation`,
      )
      .send({ locale: 'fr' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => narrationReply()),
    )
    await speak(ada, slideId, { locale: 'fr' })

    const doc = await SlideTranslationModel.findOne({ deckId, locale: 'fr' })
    expect(doc!.perSlide.get(second._id.toString())).toBeTruthy()
  })
})

describe('the two fingerprints in one entry', () => {
  it('re-translates an edited narration and nothing else', async () => {
    await speak(ada, slideId, { locale: 'fr' })
    const before = await entryFor('fr')

    await act(ada, 'slide.editTranscript', {
      slideId,
      transcript: 'Actually, the nodes are where nothing moves.',
    })
    await speak(ada, slideId, { locale: 'fr' })

    const after = await entryFor('fr')
    expect(after!.narration).toContain('Actually')
    expect(after!.narrationHash).not.toBe(before!.narrationHash)
    // The slide's own text was not touched, so it must not have been re-bought.
    expect(after!.sourceHash).toBe(before!.sourceHash)
    expect(after!.slots).toEqual(before!.slots)
  })

  it('re-translates edited slide content and keeps the narration', async () => {
    await speak(ada, slideId, { locale: 'fr' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => narrationReply()),
    )
    const before = await entryFor('fr')

    await act(ada, 'slide.editContent', { slideId, title: 'Travelling waves' })
    // A viewer re-reads the deck, which re-translates the edited slide.
    const slug = (await DeckModel.findById(deckId))!.permalinkSlug
    await request(server)
      .post(`/api/decks/${slug}/translation`)
      .send({ locale: 'fr' })

    const after = await entryFor('fr')
    expect(after!.sourceHash).not.toBe(before!.sourceHash)
    // The narration survived a rewrite of the entry it lives in.
    expect(after!.narration).toBe(before!.narration)
    expect(after!.narrationHash).toBe(before!.narrationHash)
  })

  it('carries the narration across a layout switch', async () => {
    await speak(ada, slideId, { locale: 'fr' })
    const before = await entryFor('fr')

    // A layout switch moves boxes; it does not change what the lecturer said.
    await act(ada, 'slide.setLayout', { slideId, layoutType: 'title' })

    const after = await entryFor('fr')
    expect(after!.narration).toBe(before!.narration)
    expect(after!.narrationHash).toBe(before!.narrationHash)
  })
})

describe('the voice cascade', () => {
  it('keeps a chosen voice for the language the deck declares', async () => {
    // The regression: a deck declaring `language: 'en'` used to fail the
    // voice/language comparison and silently lose the voice its owner picked.
    await act(ada, 'deck.setTtsVoice', { deckId, voice: 'emma' })
    const withoutLanguage = await speak(ada, slideId)
    await DeckModel.updateOne({ _id: deckId }, { $set: { language: 'en' } })
    const withLanguage = await speak(ada, slideId)
    expect(withLanguage.body.url).toBe(withoutLanguage.body.url)
  })

  it('drops the voice name but keeps its gender in another language', async () => {
    const synthesize = vi.spyOn(registry.get<TtsProvider>('tts'), 'synthesize')
    try {
      await act(ada, 'deck.setTtsVoice', { deckId, voice: 'emma' })
      await speak(ada, slideId, { locale: 'fr' })
      expect(synthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          languageCode: 'fr-FR',
          voiceName: undefined,
          gender: 'female',
        }),
      )
    } finally {
      synthesize.mockRestore()
    }
  })
})

describe('metering', () => {
  const spent = (
    metric:
      | 'translationCharacters'
      | 'audienceLocales'
      | 'ttsCharacters'
      | 'audienceTtsCharacters',
  ) => usedThisPeriod(adaId, metric)

  it('charges an owner’s play to the authoring allowances', async () => {
    await speak(ada, slideId, { locale: 'fr' })
    expect(await spent('translationCharacters')).toBe(transcript.length)
    expect(await spent('ttsCharacters')).toBeGreaterThan(0)
    expect(await spent('audienceLocales')).toBe(0)
    expect(await spent('audienceTtsCharacters')).toBe(0)
  })

  it('charges a listener’s play to the owner’s audience allowances', async () => {
    await speak(byron, slideId, { locale: 'fr' })
    expect(await spent('audienceLocales')).toBe(1)
    expect(await spent('audienceTtsCharacters')).toBeGreaterThan(0)
    // Never the owner's own pool: a deck that finds an audience must not eat
    // the allowance its author needs for tomorrow's lecture (BILL-3).
    expect(await spent('translationCharacters')).toBe(0)
    expect(await spent('ttsCharacters')).toBe(0)
  })

  it('costs a class nothing to listen to a lecture already spoken once', async () => {
    await speak(ada, slideId, { locale: 'fr' })
    const translated = await spent('translationCharacters')
    const synthesized = await spent('ttsCharacters')

    await speak(ada, slideId, { locale: 'fr' })
    await speak(byron, slideId, { locale: 'fr' })

    expect(await spent('translationCharacters')).toBe(translated)
    expect(await spent('ttsCharacters')).toBe(synthesized)
    expect(await spent('audienceLocales')).toBe(0)
    expect(await spent('audienceTtsCharacters')).toBe(0)
  })

  it('refuses when the owner’s translation allowance is spent', async () => {
    await UsageRecordModel.updateOne(
      {
        userId: adaId,
        period: await periodKeyFor(adaId),
        metric: 'translationCharacters',
      },
      {
        $set: {
          used: capFor('free', 'translationCharacters') ?? 0,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )
    expect((await speak(ada, slideId, { locale: 'fr' })).status).toBe(402)
    // Refused before it could spend the other allowance too.
    expect(await spent('ttsCharacters')).toBe(0)
  })
})

describe('when the translator cannot be reached', () => {
  it('refuses rather than speaking the wrong language', async () => {
    const provider = registry.get<TranslationProvider>('translation')
    const original = provider.translate.bind(provider)
    provider.translate = async () => {
      throw new Error('upstream is down')
    }
    try {
      const res = await speak(ada, slideId, { locale: 'fr' })
      // A student reading French must not suddenly hear English, with nothing
      // on screen to explain why.
      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('translation_failed')
      expect(await SlideTranslationModel.countDocuments({})).toBe(0)
    } finally {
      provider.translate = original
    }
  })

  it('is unchanged where translated viewing is switched off', async () => {
    const counter = countingProvider()
    const provider = env.TRANSLATION_PROVIDER
    try {
      // TECH-4: with no translation provider there is no translated view to
      // narrate, so a locale means nothing and playback is exactly as before.
      Object.assign(env, { TRANSLATION_PROVIDER: 'none' })
      const plain = await speak(ada, slideId)
      const asked = await speak(ada, slideId, { locale: 'fr' })
      expect(asked.status).toBe(200)
      expect(asked.body.url).toBe(plain.body.url)
      expect(counter.calls).toBe(0)
    } finally {
      Object.assign(env, { TRANSLATION_PROVIDER: provider })
      counter.restore()
    }
  })
})

describe('the audio cache', () => {
  it('shares one stored object between lectures saying the same words', async () => {
    // Nothing about the caching is specific to translation: a translated
    // narration is another entry under the existing content-addressed scheme,
    // so two decks whose French is character-identical cost one file.
    const project = await act(byron, 'project.create', { title: 'Physique' })
    const other = await act(byron, 'deck.create', {
      projectId: project.body.id,
      title: 'Ondes',
      templateId: 'classic',
    })
    const twin = await SlideModel.create({
      deckId: new Types.ObjectId(other.body.id as string),
      index: 0,
      layoutType: 'content',
      sourceTranscript: transcript,
    })

    const mine = await speak(ada, slideId, { locale: 'fr' })
    const theirs = await speak(byron, twin._id.toString(), { locale: 'fr' })
    expect(theirs.body.url).toBe(mine.body.url)

    // ...and both lectures hold a claim on it, so neither deletion strands the
    // other's audio (P-11).
    const objects = await TtsObjectModel.find({})
    const shared = objects.find(o => o.deckIds.length === 2)
    expect(shared).toBeTruthy()
  })
})
