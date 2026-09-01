/**
 * Integration tests for deck round-trip import (EXP-3) against a real MongoDB.
 * Exercises a full export → import round-trip, template/settings validation with
 * warnings, atomic rejection of malformed input (nothing created), ownership
 * enforcement, and rollback when a write fails midway.
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
import YAML from 'yaml'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SeedAssetModel } from '../../src/models/seed-asset'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { defaultTemplateId } from '../../src/templates/builtin'
import {
  BYTES_PER_MB,
  capFor,
  recordUsage,
  usedThisPeriod,
} from '../../src/billing/usage'

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

/** A minimal, well-formed deck export as `deckToYaml` would produce. */
const exportDoc = (over: Record<string, unknown> = {}) => ({
  version: 1,
  kind: 'deck',
  title: 'Photosynthesis',
  templateId: 'classic',
  settings: { language: 'fr', generationFreedom: 4, ttsVoice: 'emma' },
  slides: [
    { layout: 'title', title: 'Photosynthesis', body: 'Overview' },
    {
      layout: 'list',
      title: 'Steps',
      bullets: ['Light', 'Dark'],
      image: {
        ref: 'https://img/leaf.jpg',
        source: 'stock',
        caption: 'A leaf',
        attribution: { creator: 'Ada', license: 'CC BY' },
      },
    },
  ],
  ...over,
})

const yamlFor = (over: Record<string, unknown> = {}): string =>
  YAML.stringify(exportDoc(over))

let ada: string
let bob: string
let projectId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    SeedAssetModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Target' })
  projectId = project.body.id
})

describe('deck.import (EXP-3)', () => {
  it('imports a deck, its slides, settings, and extracted seed material', async () => {
    const res = await act(ada, 'deck.import', { projectId, content: yamlFor() })
    expect(res.status).toBe(200)
    expect(res.body.warnings).toEqual([])
    const deck = res.body.deck
    expect(deck.title).toBe('Photosynthesis')
    expect(deck.templateId).toBe('classic')
    expect(deck.language).toBe('fr')
    expect(deck.generationFreedom).toBe(4)
    expect(deck.ttsVoice).toBe('emma')

    // Slides are recreated in order with content preserved.
    const deckDoc = await DeckModel.findById(deck.id)
    const slides = await SlideModel.find({ deckId: deckDoc!._id }).sort({
      index: 1,
    })
    expect(slides).toHaveLength(2)
    expect(slides[0]!.layoutType).toBe('title')
    expect(slides[1]!.bullets).toEqual(['Light', 'Dark'])
    expect(slides[1]!.imageRef).toBe('https://img/leaf.jpg')
    expect(slides[1]!.caption).toBe('A leaf')
    // Image attribution/license (IMG-5) survives the round-trip.
    expect(slides[1]!.attribution).toMatchObject({
      creator: 'Ada',
      license: 'CC BY',
    })
    // imageSource is preserved so AI-sourced credit stays read-only on import.
    expect(slides[1]!.imageSource).toBe('stock')
    // slideOrder stays in step with slide index.
    expect(deckDoc!.slideOrder).toHaveLength(2)

    // No seed material is created — it is neither exported nor imported.
    const assets = await SeedAssetModel.find({ deckId: deckDoc!._id })
    expect(assets).toHaveLength(0)
  })

  it('round-trips a real exported YAML, but not seed notes or material (privacy)', async () => {
    // Build a source deck carrying settings, slides, seed notes, and a seed
    // asset, export it, then import the produced file into a fresh project.
    const src = await act(ada, 'deck.create', {
      projectId,
      title: 'Source',
      templateId: 'classic',
    })
    const srcDoc = await DeckModel.findById(src.body.id)
    srcDoc!.language = 'es'
    srcDoc!.generationFreedom = 2
    srcDoc!.seedContext = 'Some seed notes'
    await srcDoc!.save()
    await SlideModel.create({
      deckId: srcDoc!._id,
      index: 0,
      layoutType: 'list',
      title: 'Where',
      bullets: ['In chloroplasts'],
      imageRef: 'https://img/leaf.jpg',
      imageSource: 'stock',
      caption: 'A green leaf',
      attribution: {
        creator: 'Ada Lovelace',
        creatorUrl: 'https://example.com/ada',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        sourceName: 'Wikimedia Commons',
      },
    })
    await SeedAssetModel.create({
      projectId: srcDoc!.projectId,
      deckId: srcDoc!._id,
      type: 'pdf',
      name: 'src.pdf',
      status: 'ready',
      text: 'photosynthesis',
      keywords: [],
      enabled: true,
    })

    const dl = await act(ada, 'export.download', {
      deckId: src.body.id,
      format: 'yaml',
    })
    const content = Buffer.from(dl.body.contentBase64, 'base64').toString(
      'utf8',
    )
    // The exported file must not contain the seed notes or material.
    expect(content).not.toContain('Some seed notes')
    expect(content).not.toContain('src.pdf')

    const other = await act(ada, 'project.create', { title: 'Other' })
    const imp = await act(ada, 'deck.import', {
      projectId: other.body.id,
      content,
    })
    expect(imp.status).toBe(200)
    expect(imp.body.deck.title).toBe('Source')
    expect(imp.body.deck.language).toBe('es')
    expect(imp.body.deck.generationFreedom).toBe(2)
    // Seed notes are not carried; no seed assets are imported.
    expect(imp.body.deck.seedContext).toBeUndefined()
    const importedSlides = await SlideModel.find({ deckId: imp.body.deck.id })
    expect(importedSlides).toHaveLength(1)
    // The image, its provenance, caption, and full TASL attribution survive the
    // YAML pipeline — so a stock image's credit stays read-only after import.
    expect(importedSlides[0]!.imageRef).toBe('https://img/leaf.jpg')
    expect(importedSlides[0]!.imageSource).toBe('stock')
    expect(importedSlides[0]!.caption).toBe('A green leaf')
    expect(importedSlides[0]!.attribution).toMatchObject({
      creator: 'Ada Lovelace',
      creatorUrl: 'https://example.com/ada',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      sourceName: 'Wikimedia Commons',
    })
    const importedAssets = await SeedAssetModel.find({
      deckId: imp.body.deck.id,
    })
    expect(importedAssets).toHaveLength(0)
  })

  it('falls back to the default template with a warning for an unknown one', async () => {
    const res = await act(ada, 'deck.import', {
      projectId,
      content: yamlFor({ templateId: 'no-such-template' }),
    })
    expect(res.status).toBe(200)
    expect(res.body.deck.templateId).toBe(defaultTemplateId())
    expect(res.body.warnings.join(' ')).toMatch(/Unknown template/)
  })

  it('drops invalid settings with warnings but still imports', async () => {
    const res = await act(ada, 'deck.import', {
      projectId,
      content: yamlFor({
        settings: { language: 'xx', generationFreedom: 9, ttsVoice: 'nope' },
      }),
    })
    expect(res.status).toBe(200)
    expect(res.body.deck.language).toBeUndefined()
    expect(res.body.deck.generationFreedom).toBeUndefined()
    expect(res.body.deck.ttsVoice).toBeUndefined()
    expect(res.body.warnings).toHaveLength(3)
  })

  it('rejects malformed content and creates nothing', async () => {
    const before = await DeckModel.countDocuments()
    const res = await act(ada, 'deck.import', {
      projectId,
      content: 'kind: template\nslides: not-an-array\n',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.details.length).toBeGreaterThan(0)
    expect(await DeckModel.countDocuments()).toBe(before)
    expect(await SlideModel.countDocuments()).toBe(0)
  })

  it('forbids importing into a project the caller does not own', async () => {
    const res = await act(bob, 'deck.import', { projectId, content: yamlFor() })
    expect(res.status).toBe(403)
    expect(await DeckModel.countDocuments()).toBe(0)
  })

  it('rolls back the whole import when a write fails midway', async () => {
    // Make slide creation throw after the deck is created; the deck (and any
    // slides) must be removed so no partial lecture remains.
    const spy = vi
      .spyOn(SlideModel, 'create')
      .mockRejectedValue(new Error('boom') as never)
    const res = await act(ada, 'deck.import', { projectId, content: yamlFor() })
    expect(res.status).toBeGreaterThanOrEqual(400)
    spy.mockRestore()
    expect(await DeckModel.countDocuments()).toBe(0)
    expect(await SlideModel.countDocuments()).toBe(0)
    expect(await SeedAssetModel.countDocuments()).toBe(0)
  })
})

/** Import metering (BILL-3): the volume imported, in megabytes. */
describe('deck.import metering', () => {
  const adaId = async () =>
    (await UserModel.findOne({ email: 'ada@example.com' }))!._id.toString()

  it('charges the payload’s size in megabytes', async () => {
    const content = yamlFor()

    await act(ada, 'deck.import', { projectId, content })

    expect(await usedThisPeriod(await adaId(), 'importMb')).toBeCloseTo(
      Buffer.byteLength(content, 'utf8') / BYTES_PER_MB,
      9,
    )
  })

  it('charges nothing for a paste that does not parse', async () => {
    // Nothing was imported, so nothing is spent.
    const res = await act(ada, 'deck.import', {
      projectId,
      content: 'not: a: deck',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await usedThisPeriod(await adaId(), 'importMb')).toBe(0)
  })

  it('charges nothing for an import that rolled back', async () => {
    const spy = vi
      .spyOn(SlideModel, 'create')
      .mockRejectedValue(new Error('boom') as never)

    const res = await act(ada, 'deck.import', { projectId, content: yamlFor() })

    spy.mockRestore()
    expect(res.status).toBeGreaterThanOrEqual(400)
    // The lecture was removed, so the volume it would have counted goes with it.
    expect(await DeckModel.countDocuments()).toBe(0)
    expect(await usedThisPeriod(await adaId(), 'importMb')).toBe(0)
  })

  it('402s once the allowance is spent', async () => {
    await recordUsage(await adaId(), 'importMb', capFor('free', 'importMb')!)

    const res = await act(ada, 'deck.import', { projectId, content: yamlFor() })

    expect(res.status).toBe(402)
    expect(res.body.error.details).toEqual(['importMb'])
    // Blocked before execute, so no lecture was created.
    expect(await DeckModel.countDocuments()).toBe(0)
  })
})
