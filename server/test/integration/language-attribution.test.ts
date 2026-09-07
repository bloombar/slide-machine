/**
 * Integration tests for the language a metered event was for (BILL-7,
 * SHARE-2, PLAY-3).
 *
 * The question these exist to make answerable is "how many students read this
 * lecture in Mandarin, and how many in French". Nothing else in the system can
 * answer it: `SlideTranslation` knows which languages a lecture exists in and
 * when each first appeared, and the ledger knows who read it and how often,
 * but the first viewer of a language creates the entry and everyone behind
 * them is a cache hit — so in a class of thirty, twenty-eight readings cannot
 * be assigned a language by any join on the two.
 *
 * They go through the real routes rather than calling the ledger directly,
 * because the failure being guarded against is a route that meters without
 * establishing who and what the work was for — which is exactly what the
 * translation route did, and which no unit test of the writer would catch.
 *
 * Needs both mocks at once, so it sits beside translated-narration.test.ts for
 * the same reason that file does.
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
import type { UsageMetric } from '@slide-machine/shared'

// Force the mock TTS adapter (no paid API), the way tts.test.ts does.
// Translation is already pinned to `mock` for every suite in vitest.config.ts.
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, TTS_PROVIDER: 'mock' },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SlideTranslationModel } from '../../src/models/slide-translation'
import { TtsObjectModel } from '../../src/models/tts-object'
import { CostEventModel } from '../../src/models/cost-event'
import { UsageRecordModel } from '../../src/models/usage-record'
import { RefreshTokenModel } from '../../src/models/refresh-token'

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

/** Read the lecture in a language, signed in or not. */
const read = (locale: string, token?: string) => {
  const req = request(server).post(`/api/decks/${slug}/translation`)
  if (token) req.set('Authorization', `Bearer ${token}`)
  return req.send({ locale })
}

/** Play a slide's narration, optionally in another language and/or mode. */
const speak = (token: string, body: { locale?: string; mode?: string } = {}) =>
  request(server)
    .post(`/api/slides/${slideId}/tts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'content', ...body })

/** Every ledger row for one metric, oldest first. */
const rowsFor = async (metric: UsageMetric) =>
  CostEventModel.find({ metric }).sort({ _id: 1 }).lean()

/** The one row a metric is expected to have. Throws rather than returning
 * undefined, so a missing row fails as itself instead of as ten null reads. */
const rowFor = async (metric: UsageMetric) => {
  const [row] = await rowsFor(metric)
  if (!row) throw new Error(`no ledger row for ${metric}`)
  return row
}

let ada: string
let adaId: string
let byron: string
let byronId: string
let curie: string
let curieId: string
let deckId: string
let slug: string
let slideId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SlideTranslationModel.init(),
    TtsObjectModel.init(),
    CostEventModel.init(),
  ])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    SlideTranslationModel.deleteMany({}),
    TtsObjectModel.deleteMany({}),
    CostEventModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  byron = await registerUser('byron@example.com')
  byronId = (await UserModel.findOne({
    email: 'byron@example.com',
  }))!._id.toString()
  curie = await registerUser('curie@example.com')
  curieId = (await UserModel.findOne({
    email: 'curie@example.com',
  }))!._id.toString()

  const project = await act(ada, 'project.create', { title: 'Physics' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  // Unique per run: the audio cache lives on disk and outlives the database,
  // so a fixed title would make the first narration a hit on the second run.
  const nonce = Math.random().toString(36).slice(2)
  const slide = await SlideModel.create({
    deckId: new Types.ObjectId(deckId),
    index: 0,
    layoutType: 'content',
    title: `Standing waves ${nonce}`,
    body: 'A wave that stays in place.',
  })
  slideId = slide._id.toString()
  await CostEventModel.deleteMany({}) // ignore setup's own metering
})

describe('reading a lecture in another language', () => {
  it('records the language, the reader, and the lecture', async () => {
    expect((await read('zh', byron)).status).toBe(200)

    const row = await rowFor('audienceLocales')
    expect(row.locale).toBe('zh')
    // The other half of the same fix: before the route established an
    // attribution context, the metering underneath it ran with none, and the
    // row landed as system work on no lecture — charged to the right account
    // and useless for saying who read what.
    expect(row.actorKind).toBe('audience')
    expect(row.actorId?.toString()).toBe(byronId)
    expect(row.deckId?.toString()).toBe(deckId)
    expect(row.payerId.toString()).toBe(adaId)
    expect(row.deckName).toBe('Waves')
  })

  it('records the language on a cache hit too', async () => {
    // Byron pays for Mandarin; Curie reads the stored translation for nothing.
    // This is the case the whole field exists for — in a real class almost
    // every row is this one.
    await read('zh', byron)
    await read('zh', curie)

    const rows = await rowsFor('audienceLocales')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.locale)).toEqual(['zh', 'zh'])
    expect(rows.map(r => r.billable)).toEqual([true, false])
    expect(rows.map(r => r.actorId?.toString())).toEqual([byronId, curieId])
  })

  it('counts students per language, which is the question it exists for', async () => {
    // Two languages needs an allowance for two. Free sells exactly one
    // (config/plans.json), so on the default tier the second language is
    // refused before it is ever recorded — correct, and not what this is
    // about; an instructor running a class this size is not on free.
    await UserModel.updateOne({ _id: adaId }, { $set: { planTier: 'pro' } })
    await read('zh', byron)
    expect((await read('zh', curie)).status).toBe(200)
    expect((await read('fr', curie)).status).toBe(200)

    const perLanguage = await CostEventModel.aggregate<{
      _id: string
      students: number
      reads: number
    }>([
      {
        $match: {
          metric: 'audienceLocales',
          deckId: new Types.ObjectId(deckId),
        },
      },
      {
        $group: {
          _id: '$locale',
          students: { $addToSet: '$actorId' },
          reads: { $sum: 1 },
        },
      },
      { $project: { students: { $size: '$students' }, reads: 1 } },
      { $sort: { _id: 1 } },
    ])

    expect(perLanguage).toEqual([
      { _id: 'fr', students: 1, reads: 1 },
      { _id: 'zh', students: 2, reads: 2 },
    ])
  })

  // Translated viewing needs an account (SHARE-2, narrowed by AUTH-8), so
  // there is no anonymous reading to attribute here any more — the refusal
  // happens before anything is spent or recorded. Signed-out readers are
  // counted where they still exist: opening a lecture (EVAL-7).
  it('spends nothing and records nothing for a reader with no account', async () => {
    expect((await read('fr')).status).toBe(401)

    expect(await CostEventModel.countDocuments({})).toBe(0)
    expect(await UsageRecordModel.countDocuments({})).toBe(0)
  })

  it('records the language when the owner translates their own lecture', async () => {
    await read('es', ada)

    const row = await rowFor('translationCharacters')
    expect(row.locale).toBe('es')
    expect(row.actorKind).toBe('owner')
    expect(row.actorId?.toString()).toBe(adaId)
  })

  it('writes nothing at all for the language it is already in', async () => {
    expect((await read('en', byron)).status).toBe(200)
    // Not "a row saying English": asking for the source language is a no-op
    // that never reaches the meter, and inventing a row here would inflate the
    // one language the question is least about.
    expect(await CostEventModel.countDocuments({})).toBe(0)
  })
})

describe('hearing a lecture narrated', () => {
  it('records the language it was heard in', async () => {
    expect((await speak(byron, { locale: 'fr' })).status).toBe(200)

    const rows = await CostEventModel.find({ locale: { $ne: null } }).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.locale === 'fr')).toBe(true)
    expect(
      rows.some(r => r.metric.startsWith('audienceTts') && r.locale === 'fr'),
    ).toBe(true)
  })

  it('records the original language when nothing was translated', async () => {
    expect((await speak(byron)).status).toBe(200)

    const rows = await CostEventModel.find({
      metric: { $regex: '^audienceTts' },
    }).lean()
    expect(rows.length).toBeGreaterThan(0)
    // Every play is in some language. Leaving the untranslated ones blank
    // would make them an unlabelled remainder rather than a count.
    expect(rows.every(r => r.locale === 'en')).toBe(true)
  })
})

// The bug this file exists to guard against: a translation row does not say
// whether it happened because someone read the lecture or because narration
// needed the words first, so a class that reads a deck once and then listens
// to it looks, by row count, like a class that read it many times.
describe('why a translation happened', () => {
  it('labels a reading', async () => {
    expect((await read('fr', byron)).status).toBe(200)

    const row = await rowFor('audienceLocales')
    expect(row.trigger).toBe('reading')
  })

  it('labels translation performed only so content-mode narration could speak', async () => {
    expect((await speak(byron, { locale: 'fr' })).status).toBe(200)

    // The narration route's own translation event, not the audio-synthesis
    // row beside it (that one carries no trigger at all — see below).
    const row = await rowFor('audienceLocales')
    expect(row.trigger).toBe('narration')
  })

  it('labels translation performed only so transcript-mode narration could speak', async () => {
    await SlideModel.updateOne(
      { _id: slideId },
      { $set: { sourceTranscript: 'A wave that stays in place.' } },
    )
    expect(
      (await speak(byron, { locale: 'fr', mode: 'transcript' })).status,
    ).toBe(200)

    const row = await rowFor('audienceLocales')
    expect(row.trigger).toBe('narration')
  })

  it('leaves no trigger on the audio-synthesis row beside a translation', async () => {
    expect((await speak(byron, { locale: 'fr' })).status).toBe(200)

    const synthesisRows = await CostEventModel.find({
      metric: { $regex: '^audienceTts' },
    }).lean()
    expect(synthesisRows.length).toBeGreaterThan(0)
    // Synthesizing audio is not translation, whatever attribution the request
    // that caused it happens to carry — stamping every row this route writes
    // with 'narration' would claim a translation on rows where none happened.
    expect(synthesisRows.every(r => r.trigger == null)).toBe(true)
  })

  it('leaves no trigger on a plain playback that never translates anything', async () => {
    expect((await speak(byron)).status).toBe(200)

    const rows = await CostEventModel.find({}).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.trigger == null)).toBe(true)
  })

  it('leaves no trigger on non-language work', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })

    const rows = await CostEventModel.find({}).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.trigger == null)).toBe(true)
  })

  // The end-to-end shape of the bug, and the test that proves the fix: a
  // student reads the lecture once, then listens to three slides. Without the
  // trigger, all four rows look like readings; with it, filtering to
  // trigger = 'reading' returns exactly the one that was.
  it('leaves exactly one reading row behind any number of narration requests', async () => {
    expect((await read('fr', byron)).status).toBe(200)
    for (let i = 0; i < 3; i += 1) {
      expect((await speak(byron, { locale: 'fr' })).status).toBe(200)
    }

    const rows = await rowsFor('audienceLocales')
    expect(rows).toHaveLength(4)
    expect(rows.filter(r => r.trigger === 'reading')).toHaveLength(1)
    expect(rows.filter(r => r.trigger === 'narration')).toHaveLength(3)
  })

  // Regression: none of the above may change what pricing already recorded.
  // Same row count, same billable/quantity/costMicros `audienceLocales`
  // already had — the reading spends the allowance for the new language (as
  // the pre-existing "records the language, the reader, and the lecture" and
  // "records the language on a cache hit too" tests already establish), and
  // the narration behind it is a cache hit against that same language, same
  // as any other reader arriving after the first. `trigger` only labels
  // these; it changes neither.
  it('changes no pricing figure while labelling the rows', async () => {
    expect((await read('fr', byron)).status).toBe(200)
    expect((await speak(byron, { locale: 'fr' })).status).toBe(200)

    const rows = await rowsFor('audienceLocales')
    expect(rows).toHaveLength(2)
    const [reading, narration] = rows
    if (!reading || !narration) throw new Error('expected two rows')
    expect(reading.trigger).toBe('reading')
    expect(reading.billable).toBe(true)
    expect(reading.quantity).toBe(1)
    expect(reading.costMicros).toBe(0) // priced on translationCharacters instead (BILL-7)

    expect(narration.trigger).toBe('narration')
    expect(narration.billable).toBe(false)
    expect(narration.quantity).toBe(0)
    expect(narration.costMicros).toBe(0)
  })
})

describe('work that has no language', () => {
  it('leaves the language blank rather than defaulting to English', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })

    const rows = await CostEventModel.find({}).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.locale === null)).toBe(true)
  })

  // The counter-case to the one above: an export that names a language is
  // language-bearing work, and a blank there would say the opposite. The
  // dispatcher establishes the usage context but cannot know a locale that
  // is an argument to the action rather than a fact about the deck.
  it('records the language when the export names one', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml', locale: 'fr' })

    const rows = await CostEventModel.find({
      metric: 'translationCharacters',
    }).lean()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.locale === 'fr')).toBe(true)
  })
})

describe('the language recorded is the one actually spoken', () => {
  /** Narrate one slide with the server default set to `tag`, and report every
   * language the ledger recorded for it. */
  const spokenUnder = async (tag: string) => {
    const original = env.TTS_LANGUAGE
    ;(env as { TTS_LANGUAGE: string }).TTS_LANGUAGE = tag
    try {
      expect((await speak(byron)).status).toBe(200)
      const rows = await CostEventModel.find({
        metric: { $regex: '^audienceTts' },
      }).lean()
      expect(rows.length).toBeGreaterThan(0)
      return [...new Set(rows.map(r => r.locale ?? null))]
    } finally {
      ;(env as { TTS_LANGUAGE: string }).TTS_LANGUAGE = original
    }
  }

  // `deckSourceLocale` ends at English, but synthesis ends at TTS_LANGUAGE.
  // On a deployment that set that to anything else, a lecture declaring no
  // language was spoken in one language and recorded as another — and the
  // row cannot be recomputed later.
  it('follows the server default when the lecture declares no language', async () => {
    expect(await spokenUnder('fr-FR')).toEqual(['fr'])
  })

  // The tag this app itself uses for Mandarin. Its base subtag is 'cmn', which
  // is not a locale, so reading the subtag alone recorded English narration
  // that never happened — on the very language the per-language question was
  // written about.
  it('reads Mandarin back through the table that produced its tag', async () => {
    expect(await spokenUnder('cmn-CN')).toEqual(['zh'])
  })

  // A qualified tag the table does not list still answers by subtag.
  it('still resolves a regional variant of a language it does have', async () => {
    expect(await spokenUnder('en-GB')).toEqual(['en'])
  })

  // Better silent than confidently wrong: the ledger already reads a blank
  // locale as "this work had no language", which is true here in the only
  // sense available — none that this app knows.
  it('records no language rather than the wrong one for a tag it cannot place', async () => {
    expect(await spokenUnder('pt-BR')).toEqual([null])
  })
})
