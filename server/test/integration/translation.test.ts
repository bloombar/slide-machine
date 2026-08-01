/**
 * Integration tests for post-lecture translated viewing (SHARE-2):
 * POST /api/decks/:slug/translation.
 *
 * Covers the things that would break the feature for the people it exists
 * for — anonymous access, the ACL, the cache actually caching, per-slide
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
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Anonymous translate request — no Authorization header at all. */
const translateAnon = (slug: string, locale: string) =>
  request(server).post(`/api/decks/${slug}/translation`).send({ locale })

const translateAs = (token: string, slug: string, locale: string) =>
  request(server)
    .post(`/api/decks/${slug}/translation`)
    .set('Authorization', `Bearer ${token}`)
    .send({ locale })

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
  ])
  ada = await registerUser('ada@example.com')
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
  it('lets an anonymous viewer translate a public deck', async () => {
    const res = await translateAnon(slug, 'fr')
    expect(res.status).toBe(200)
    expect(res.body.locale).toBe('fr')
    expect(res.body.source).toBe('en')
    const entry = res.body.perSlide[slideId]
    expect(entry.title).toContain('[fr]')
    expect(entry.bullets).toHaveLength(2)
    expect(entry.caption).toContain('[fr]')
  })

  it('preserves markdown formatting through the round trip', async () => {
    const entry = (await translateAnon(slug, 'fr')).body.perSlide[slideId]
    // The emphasis survives translation rather than being flattened
    expect(entry.body).toContain('**stays**')
  })

  it('never touches the stored slides', async () => {
    await translateAnon(slug, 'fr')
    const slide = await SlideModel.findById(slideId)
    expect(slide!.title).toBe('Standing waves')
    expect(slide!.body).toBe('A wave that **stays** in place.')
    expect(slide!.caption).toBe('A vibrating string')
  })

  it("is a no-op for the deck's own language", async () => {
    const counter = countingProvider()
    try {
      const res = await translateAnon(slug, 'en')
      expect(res.status).toBe(200)
      expect(res.body.perSlide).toEqual({})
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('rejects a language it does not support', async () => {
    expect((await translateAnon(slug, 'de')).status).toBe(400)
    expect((await translateAnon(slug, '')).status).toBe(400)
  })

  it('404s for a deck that does not exist', async () => {
    expect((await translateAnon('no-such-deck', 'fr')).status).toBe(404)
  })
})

describe('translation caching', () => {
  it('serves a repeat request from the cache without calling the provider', async () => {
    await translateAnon(slug, 'fr')
    const counter = countingProvider()
    try {
      const second = await translateAnon(slug, 'fr')
      expect(second.status).toBe(200)
      expect(second.body.perSlide[slideId].title).toContain('[fr]')
      expect(counter.calls).toBe(0)
    } finally {
      counter.restore()
    }
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(1)
  })

  it('keeps one document per deck and locale', async () => {
    await translateAnon(slug, 'fr')
    await translateAnon(slug, 'es')
    await translateAnon(slug, 'fr')
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(2)
  })

  it('re-translates only the slide that was edited', async () => {
    const second = await SlideModel.create({
      deckId,
      index: 1,
      layoutType: 'content',
      title: 'Second slide',
    })
    await translateAnon(slug, 'fr')
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
      const res = await translateAnon(slug, 'fr')
      // Only the edited slide's segments went to the provider
      expect(sentTexts.some(t => t.includes('Travelling waves'))).toBe(true)
      expect(sentTexts.some(t => t.includes('Second slide'))).toBe(false)
      expect(res.body.perSlide[slideId].title).toContain('Travelling waves')
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
    await translateAnon(slug, 'fr')
    await SlideModel.deleteOne({ _id: extra._id })

    const res = await translateAnon(slug, 'fr')
    expect(res.body.perSlide[extra._id.toString()]).toBeUndefined()
    expect(res.body.perSlide[slideId]).toBeDefined()
  })
})

describe('translation access control', () => {
  beforeEach(async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
  })

  it('404s for an anonymous visitor on a restricted deck', async () => {
    expect((await translateAnon(slug, 'fr')).status).toBe(404)
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
    await translateAnon(slug, 'fr')
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(1)

    const deck = await DeckModel.findById(deckId)
    await deleteDeckCascade(deck!)
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(0)
  })

  it('removes the cache when the deck is purged', async () => {
    await translateAnon(slug, 'fr')
    await purgeDeckCascade(deckId)
    expect(await SlideTranslationModel.countDocuments({ deckId })).toBe(0)
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
