/**
 * Integration tests for post-lecture translated viewing (SHARE-2):
 * POST /api/decks/:slug/translation.
 *
 * Covers the things that would break the feature for the people it exists
 * for — the sign-in gate, the ACL, the cache actually caching, per-slide
 * staleness after an edit, and the guarantee that nothing here ever writes to
 * the slides themselves. TRANSLATION_PROVIDER is pinned to `mock` in the
 * vitest env, which prefixes each segment with `[<locale>]`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { TranslationProvider } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { registry } from '../../src/providers/registry'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SlideTranslationModel } from '../../src/models/slide-translation'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { capFor, periodKeyFor, usedThisPeriod } from '../../src/billing/usage'
import { deleteDeckCascade, purgeDeckCascade } from '../../src/lib/cascade'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(`registration failed: ${res.status}`)
  }
  // These accounts are ordinary users of a running app, so their address is
  // confirmed: an unconfirmed one keeps its projects restricted (AUTH-3).
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Anonymous translate request — no Authorization header at all. Kept for the
 * tests that are about the gate itself; SHARE-2 needs an account, so this is
 * a refusal everywhere else. */
const translateAnon = (slug: string, locale: string) =>
  request(server).post(`/api/decks/${slug}/translation`).send({ locale })

const translateAs = (token: string, slug: string, locale: string) =>
  request(server)
    .post(`/api/decks/${slug}/translation`)
    .set('Authorization', `Bearer ${token}`)
    .send({ locale })

/** The ordinary case: a signed-in reader who is not the deck's owner, so the
 * work is billed to the audience pool exactly as a student's would be. */
const translate = (slug: string, locale: string) =>
  translateAs(byron, slug, locale)

/** Counts provider calls for the duration of one assertion. */
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

let ada: string
let adaId: string
let byron: string
let projectId: string
let deckId: string
let slug: string
let slideId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SlideTranslationModel.init(),
  ])
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
    SlideTranslationModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  byron = await registerUser('byron@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  const slide = await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    title: 'Standing waves',
    body: 'A wave that **stays** in place.',
    bullets: ['Nodes', 'Antinodes'],
    caption: 'A vibrating string',
  })
  slideId = slide._id.toString()
})

describe('translated viewing', () => {
  // SHARE-2 says signed-in students and instructors, and AUTH-8 records the
  // narrowing. The page has gated this since; the route had not, so anyone
  // who skipped the UI could spend the owner's allowance without an account.
  it('refuses an anonymous viewer, whatever the deck', async () => {
    expect((await translateAnon(slug, 'fr')).status).toBe(401)
    // Checked before the ACL, so nothing leaks about which lectures exist.
    expect((await translateAnon('no-such-deck', 'fr')).status).toBe(401)
  })

  it('lets a signed-in viewer translate a public deck', async () => {
    const res = await translate(slug, 'fr')
    expect(res.status).toBe(200)
    expect(res.body.locale).toBe('fr')
    expect(res.body.source).toBe('en')
    const entry = res.body.perSlide[slideId]
    expect(entry.slots.title.value).toContain('[fr]')
    expect(entry.slots.bullets.items).toHaveLength(2)
    expect(entry.slots.caption.value).toContain('[fr]')
  })

  it('preserves markdown formatting through the round trip', async () => {
    const entry = (await translate(slug, 'fr')).body.perSlide[slideId]
    // The emphasis survives translation rather than being flattened
    expect(entry.slots.body.value).toContain('**stays**')
  })

  it('never touches the stored slides', async () => {
    await translate(slug, 'fr')
    const slide = await SlideModel.findById(slideId)
    expect(slide!.title).toBe('Standing waves')
    expect(slide!.body).toBe('A wave that **stays** in place.')
    expect(slide!.caption).toBe('A vibrating string')
  })

  it("is a no-op for the deck's own language", async () => {
    const counter = countingProvider()
    try {
      const res = await translate(slug, 'en')
      expect(res.status).toBe(200)
      expect(res.body.perSlide).toEqual({})
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('rejects a language it does not support', async () => {
    expect((await translate(slug, 'de')).status).toBe(400)
    expect((await translate(slug, '')).status).toBe(400)
  })

  it('404s for a deck that does not exist', async () => {
    expect((await translate('no-such-deck', 'fr')).status).toBe(404)
  })
})

describe('translation caching', () => {
  it('serves a repeat request from the cache without calling the provider', async () => {
    await translate(slug, 'fr')
    const counter = countingProvider()
    try {
      const second = await translate(slug, 'fr')
      expect(second.status).toBe(200)
      expect(second.body.perSlide[slideId].slots.title.value).toContain('[fr]')
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(1)
  })

  it('leaves code and mathematics untranslated', async () => {
    // Translating a listing stops it running and a formula stops it parsing.
    // The kind allowlist is what prevents it; this is the assertion that
    // would fail if somebody generalized the walk without it.
    const technical = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'content',
      slots: {
        title: { kind: 'text', value: 'Loops' },
        sample: { kind: 'code', source: 'for i in range(3): print(i)' },
        formula: { kind: 'math', tex: 'e^{i\\pi} + 1 = 0' },
      },
    })
    const res = await translate(slug, 'fr')
    const entry = res.body.perSlide[technical._id.toString()]
    expect(entry.slots.title.value).toContain('[fr]')
    expect(entry.slots.sample).toBeUndefined()
    expect(entry.slots.formula).toBeUndefined()
  })

  it('translates a box the template author named, and a table cell by cell', () =>
    (async () => {
      const custom = await SlideModel.create({
        deckId,
        index: 1,
        layoutType: 'content',
        slots: {
          definition: { kind: 'text', value: 'A standing wave' },
          grid: {
            kind: 'table',
            header: ['Term', 'Meaning'],
            rows: [['Node', 'No motion']],
          },
        },
      })
      const res = await translate(slug, 'fr')
      const entry = res.body.perSlide[custom._id.toString()]
      // Nothing here is a conventional slot name; the walk found them anyway.
      expect(entry.slots.definition.value).toContain('[fr]')
      expect(entry.slots.grid.header[0]).toContain('[fr]')
      expect(entry.slots.grid.rows[0][0]).toContain('[fr]')
      expect(entry.slots.grid.rows[0]).toHaveLength(2)
    })())

  it('carries a translation across a layout switch instead of re-buying it', async () => {
    await translate(slug, 'fr')
    const counter = countingProvider()
    try {
      // A switch between layouts that share the conventional names moves
      // nothing, so the cache must still be valid afterwards.
      await act(ada, 'slide.setLayout', { slideId, layoutType: 'title' })
      await translate(slug, 'fr')
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('does not restamp a translation that was already stale', async () => {
    // The guard that matters: an entry whose slide was edited after it was
    // translated must not be carried across a move and stamped fresh, or the
    // viewer would be shown last week's words indefinitely.
    await translate(slug, 'fr')
    await act(ada, 'slide.editContent', { slideId, title: 'Travelling waves' })
    await act(ada, 'slide.setLayout', { slideId, layoutType: 'title' })

    const doc = await SlideTranslationModel.findOne({ deckId, locale: 'fr' })
    const title = doc!.perSlide.get(slideId)!.slots.title
    // Still keyed to the pre-edit text, so the next view re-translates it.
    expect(title?.kind === 'text' ? title.value : '').toContain(
      'Standing waves',
    )

    const res = await translate(slug, 'fr')
    expect(res.body.perSlide[slideId].slots.title.value).toContain(
      'Travelling waves',
    )
  })

  it('keeps one document per deck and locale', async () => {
    // Two audience languages, so the owner needs a plan that sells two
    // (BILL-3); on Free the second request is a deliberate 402, covered in the
    // metering suite below.
    await UserModel.updateOne({ _id: adaId }, { planTier: 'pro' })
    await translate(slug, 'fr')
    await translate(slug, 'es')
    await translate(slug, 'fr')
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(2)
  })

  it('re-translates only the slide that was edited', async () => {
    const second = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'content',
      title: 'Second slide',
    })
    await translate(slug, 'fr')
    const before = await SlideTranslationModel.findOne({ deckId, locale: 'fr' })
    const untouchedHash = before!.perSlide.get(
      second._id.toString(),
    )!.sourceHash

    await act(ada, 'slide.editContent', { slideId, title: 'Travelling waves' })

    const counter = countingProvider()
    let sentTexts: string[] = []
    const provider = registry.get<TranslationProvider>('translation')
    const original = provider.translate.bind(provider)
    provider.translate = async input => {
      sentTexts = input.texts
      return original(input)
    }
    try {
      const res = await translate(slug, 'fr')
      // Only the edited slide's segments went to the provider
      expect(sentTexts.some(t => t.includes('Travelling waves'))).toBe(true)
      expect(sentTexts.some(t => t.includes('Second slide'))).toBe(false)
      expect(res.body.perSlide[slideId].slots.title.value).toContain(
        'Travelling waves',
      )
    } finally {
      provider.translate = original
      counter.restore()
    }

    const after = await SlideTranslationModel.findOne({ deckId, locale: 'fr' })
    // The untouched slide kept its entry verbatim
    expect(after!.perSlide.get(second._id.toString())!.sourceHash).toBe(
      untouchedHash,
    )
  })

  it('drops slides that no longer exist', async () => {
    const extra = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'content',
      title: 'Doomed',
    })
    await translate(slug, 'fr')
    await SlideModel.deleteOne({ _id: extra._id })

    const res = await translate(slug, 'fr')
    expect(res.body.perSlide[extra._id.toString()]).toBeUndefined()
    expect(res.body.perSlide[slideId]).toBeDefined()
  })
})

describe('translation access control', () => {
  beforeEach(async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
  })

  it('401s for an anonymous visitor on a restricted deck', async () => {
    // Not 404: sign-in is checked first, so the answer is the same one an
    // anonymous caller gets for a deck that does not exist.
    expect((await translateAnon(slug, 'fr')).status).toBe(401)
  })

  it('404s for a signed-in stranger on a restricted deck', async () => {
    expect((await translateAs(byron, slug, 'fr')).status).toBe(404)
  })

  it('serves the owner', async () => {
    expect((await translateAs(ada, slug, 'fr')).status).toBe(200)
  })

  it('serves someone the deck was shared with', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    expect((await translateAs(byron, slug, 'fr')).status).toBe(200)
  })
})

describe('translation lifecycle', () => {
  it('removes the cache when the deck is deleted, and rebuilds on demand', async () => {
    await translate(slug, 'fr')
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(1)

    const deck = await DeckModel.findById(deckId)
    await deleteDeckCascade(deck!)
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(0)
  })

  it('removes the cache when the deck is purged', async () => {
    await translate(slug, 'fr')
    await purgeDeckCascade(deckId)
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(0)
  })
})

describe('translation metering', () => {
  /** How much of a metric the deck's owner has spent this period. */
  const spent = (metric: 'translationCharacters' | 'audienceLocales') =>
    usedThisPeriod(adaId, metric)

  /** Puts the owner exactly on a cap, as though they had spent it. */
  const exhaust = async (
    metric: 'translationCharacters' | 'audienceLocales',
  ): Promise<void> => {
    await UsageRecordModel.updateOne(
      { userId: adaId, period: await periodKeyFor(adaId), metric },
      { $set: { used: capFor('free', metric) ?? 0, updatedAt: new Date() } },
      { upsert: true },
    )
  }

  it('charges the owner for the characters they translate', async () => {
    expect(await translateAs(ada, slug, 'fr')).toMatchObject({ status: 200 })
    // The deck's words plus the markup they were sent inside — what the vendor
    // bills for. The exact figure is the provider's business; that it is
    // proportional to the deck is the contract.
    expect(await spent('translationCharacters')).toBeGreaterThan(
      'Standing waves'.length,
    )
    expect(await spent('audienceLocales')).toBe(0)
  })

  it('charges a reader’s first language to the audience allowance', async () => {
    await translate(slug, 'fr')
    expect(await spent('audienceLocales')).toBe(1)
    // Never the owner's own pool: a deck that finds an audience must not eat
    // the allowance its author needs to prepare tomorrow's lecture (BILL-3).
    expect(await spent('translationCharacters')).toBe(0)
  })

  it('charges one unit per language however many students read it', async () => {
    await translate(slug, 'fr')
    await translate(slug, 'fr')
    await translateAs(byron, slug, 'fr')
    expect(await spent('audienceLocales')).toBe(1)
  })

  it('charges a second language separately', async () => {
    // Free allows exactly one audience language, which is what the next test
    // covers; here the question is only that two languages cost two units.
    await UserModel.updateOne({ _id: adaId }, { planTier: 'pro' })
    await translate(slug, 'fr')
    await translate(slug, 'es')
    expect(await spent('audienceLocales')).toBe(2)
  })

  it('holds a free account to the one audience language it is sold', async () => {
    await translate(slug, 'fr')
    expect((await translate(slug, 'es')).status).toBe(402)
    expect(await spent('audienceLocales')).toBe(1)
  })

  it('does not charge a reader for a language the owner already bought', async () => {
    await translateAs(ada, slug, 'fr')
    const before = await spent('translationCharacters')
    await translate(slug, 'fr')
    expect(await spent('audienceLocales')).toBe(0)
    expect(await spent('translationCharacters')).toBe(before)
  })

  it('records a cache hit without debiting it', async () => {
    await translateAs(ada, slug, 'fr')
    const charged = await spent('translationCharacters')
    await translateAs(ada, slug, 'fr')
    // Still exactly what the one real call cost, but a row now exists saying
    // the read happened — the count BILL-7's averages divide by.
    expect(await spent('translationCharacters')).toBe(charged)
    expect(
      await UsageRecordModel.countDocuments({
        userId: adaId,
        metric: 'translationCharacters',
      }),
    ).toBe(1)
  })

  it('refuses the owner once their translation allowance is spent', async () => {
    await exhaust('translationCharacters')
    const res = await translateAs(ada, slug, 'fr')
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('plan_limit_exceeded')
    expect(res.body.error.details).toEqual(['translationCharacters'])
    expect(res.body.error.message).toMatch(/used all of this billing period/i)
    // Hard stop, never overage: nothing was translated and nothing was cached.
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(0)
  })

  it('refuses a reader’s new language once the audience allowance is spent', async () => {
    await exhaust('audienceLocales')
    const res = await translate(slug, 'fr')
    expect(res.status).toBe(402)
    // A student is told the lecture is not readable in that language, and
    // learns nothing about their instructor's plan (BILL-4).
    expect(res.body.error.message).toBe(
      'This lecture isn’t available in that language.',
    )
    expect(res.body.error.message).not.toMatch(
      /plan|billing|allowance|upgrade/i,
    )
  })

  it('keeps serving a translation that already exists after the cap is reached', async () => {
    // Hitting a cap degrades what can be *created*, never what already exists:
    // students must not lose a translation their instructor already paid for.
    await translateAs(ada, slug, 'fr')
    await exhaust('audienceLocales')
    const res = await translate(slug, 'fr')
    expect(res.status).toBe(200)
    expect(res.body.perSlide[slideId].slots.title.value).toContain('[fr]')
  })

  it('re-translates an edited slide for readers of a language already bought', async () => {
    // The audience allowance sells languages, so it may only refuse a new one.
    // A student reading a lecture in a language it already publishes must not
    // be shown last week's words because the owner is at their limit — the
    // edit was the owner's doing, and this call is charged nothing.
    await translate(slug, 'fr')
    expect(await spent('audienceLocales')).toBe(1) // free's whole allowance
    await act(ada, 'slide.editContent', { slideId, title: 'Travelling waves' })

    const res = await translate(slug, 'fr')
    expect(res.status).toBe(200)
    expect(res.body.perSlide[slideId].slots.title.value).toContain(
      'Travelling waves',
    )
    expect(await spent('audienceLocales')).toBe(1)
  })

  it('does not report an exhausted allowance as a provider outage', async () => {
    // A 502 would tell the viewer to retry something that cannot succeed.
    await exhaust('audienceLocales')
    expect((await translate(slug, 'fr')).status).not.toBe(502)
  })

  it('charges a translated export to the owner’s own allowance', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml', locale: 'fr' })
    expect(await spent('translationCharacters')).toBeGreaterThan(0)
    // Exporting is authoring work, whoever the file is for.
    expect(await spent('audienceLocales')).toBe(0)
  })

  it('spends nothing translating a deck into its own language', async () => {
    await translateAs(ada, slug, 'en')
    await translate(slug, 'en')
    expect(await spent('translationCharacters')).toBe(0)
    expect(await spent('audienceLocales')).toBe(0)
  })
})

describe('translated export', () => {
  it('exports the translated text while the deck stays unchanged', async () => {
    const res = await act(ada, 'export.download', {
      deckId,
      format: 'yaml',
      locale: 'fr',
    })
    expect(res.status).toBe(200)
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    expect(yaml).toContain('[fr]')

    const slide = await SlideModel.findById(slideId)
    expect(slide!.title).toBe('Standing waves')
  })

  it('exports the authored text when no locale is asked for', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'yaml' })
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    expect(yaml).toContain('Standing waves')
    expect(yaml).not.toContain('[fr]')
  })

  it('rejects an unsupported export language', async () => {
    const res = await act(ada, 'export.download', {
      deckId,
      format: 'yaml',
      locale: 'de',
    })
    expect(res.status).toBe(400)
  })
})
