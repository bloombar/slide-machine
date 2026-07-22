/**
 * Integration tests for EDIT-1 actions: partial content edits, delete
 * with reindexing, reorder validation, and ownership enforcement.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

// One long-lived server per file: supertest's default per-request
// ephemeral servers intermittently lost requests to localhost port
// churn on macOS (bare 404s with no Express headers)
const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let deckId: string
let slideIds: string[]

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
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'L1',
    templateId: 'classic',
  })
  deckId = deck.body.id
  slideIds = []
  for (const phrase of [
    'Photosynthesis basics',
    'Sunlight, water, carbon dioxide',
    'But why?',
  ]) {
    const event = await act(ada, 'session.phrase', { deckId, phrase })
    slideIds.push(event.body.slide.id)
  }
})

describe('slide.editContent', () => {
  it('updates only the provided fields', async () => {
    const res = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      title: 'Intro to Photosynthesis',
    })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Intro to Photosynthesis')
    expect(res.body.layoutType).toBe('title')

    const bullets = await act(ada, 'slide.editContent', {
      slideId: slideIds[1],
      bullets: ['one', 'two'],
      caption: 'Sources',
    })
    expect(bullets.body.bullets).toEqual(['one', 'two'])
    expect(bullets.body.caption).toBe('Sources')
  })

  it('sets the image and clears it with an empty string', async () => {
    const set = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      imageRef: 'http://example.test/pic.png',
    })
    expect(set.body.imageRef).toBe('http://example.test/pic.png')

    const cleared = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      imageRef: '',
    })
    expect(cleared.body.imageRef).toBeFalsy()
  })

  it('saves image attribution and clears it when all fields go blank', async () => {
    const set = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      attribution: { creator: 'Ada', license: 'CC BY 4.0' },
    })
    expect(set.body.attribution).toMatchObject({
      creator: 'Ada',
      license: 'CC BY 4.0',
    })

    const cleared = await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      attribution: {},
    })
    expect(cleared.body.attribution).toBeFalsy()
  })

  it("403s editing another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'slide.editContent', {
      slideId: slideIds[0],
      title: 'Hijack',
    })
    expect(res.status).toBe(403)
  })
})

describe('slide.editDrawings', () => {
  const stroke = (over: object = {}) => ({
    id: 'stroke-1',
    tool: 'pen',
    color: '#1e293b',
    thickness: 0.01,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.4 },
    ],
    startedAt: '2026-07-21T10:00:00.000Z',
    endedAt: '2026-07-21T10:00:01.000Z',
    anchor: { charAnchor: 12, source: 'appended' },
    ...over,
  })

  it('saves and round-trips drawings, including a timestamped erase', async () => {
    const erased = stroke({
      id: 'stroke-2',
      tool: 'highlighter',
      color: '#fde047',
      erasedAnchor: {
        charAnchor: 40,
        source: 'word',
        sessionId: 's1',
        sessionMs: 900,
      },
      erasedAt: '2026-07-21T10:00:05.000Z',
    })
    const res = await act(ada, 'slide.editDrawings', {
      slideId: slideIds[0],
      drawings: [stroke(), erased],
    })
    expect(res.status).toBe(200)
    expect(res.body.drawings).toHaveLength(2)

    const view = await act(ada, 'deck.get', { deckId })
    const saved = view.body.slides[0].drawings
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({
      id: 'stroke-1',
      tool: 'pen',
      color: '#1e293b',
    })
    expect(saved[0].anchor).toMatchObject({
      charAnchor: 12,
      source: 'appended',
    })
    // The erased stroke is kept (not deleted) with its erase anchor for replay
    expect(saved[1].id).toBe('stroke-2')
    expect(saved[1].erasedAnchor).toMatchObject({
      charAnchor: 40,
      source: 'word',
    })
  })

  it('clamps out-of-range coordinates into the slide box', async () => {
    const res = await act(ada, 'slide.editDrawings', {
      slideId: slideIds[0],
      drawings: [
        stroke({
          points: [
            { x: -0.3, y: 1.8 },
            { x: 0.5, y: 0.5 },
          ],
        }),
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.drawings[0].points[0]).toEqual({ x: 0, y: 1 })
  })

  it('rejects a non-hex color', async () => {
    const res = await act(ada, 'slide.editDrawings', {
      slideId: slideIds[0],
      drawings: [stroke({ color: 'red' })],
    })
    expect(res.status).toBe(400)
  })

  it("403s editing another user's drawings", async () => {
    const bob = await registerUser('bob-draw@example.com')
    const res = await act(bob, 'slide.editDrawings', {
      slideId: slideIds[0],
      drawings: [stroke()],
    })
    expect(res.status).toBe(403)
  })
})

describe('slide.setLayout', () => {
  it('switches to another of the template layouts, keeping content', async () => {
    const res = await act(ada, 'slide.setLayout', {
      slideId: slideIds[0],
      layoutType: 'quote',
    })
    expect(res.status).toBe(200)
    expect(res.body.layoutType).toBe('quote')

    // Content is untouched; only the layout changed
    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides[0].layoutType).toBe('quote')
    expect(view.body.slides[0].title).toBeTruthy()
  })

  it('rejects layouts the template does not offer and foreign slides', async () => {
    expect(
      (
        await act(ada, 'slide.setLayout', {
          slideId: slideIds[0],
          layoutType: 'hologram',
        })
      ).status,
    ).toBe(400)

    const bob = await registerUser('bob-layout@example.com')
    expect(
      (
        await act(bob, 'slide.setLayout', {
          slideId: slideIds[0],
          layoutType: 'quote',
        })
      ).status,
    ).toBe(403)
  })
})

describe('slide.delete', () => {
  it('removes the slide, updates slideOrder, and reindexes the rest', async () => {
    const res = await act(ada, 'slide.delete', { slideId: slideIds[1] })
    expect(res.status).toBe(200)
    expect(res.body.slideOrder).toEqual([slideIds[0], slideIds[2]])

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(2)
    expect(
      view.body.slides.map((s: { id: string; index: number }) => [
        s.id,
        s.index,
      ]),
    ).toEqual([
      [slideIds[0], 0],
      [slideIds[2], 1],
    ])
  })

  it("403s deleting another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    expect(
      (await act(bob, 'slide.delete', { slideId: slideIds[0] })).status,
    ).toBe(403)
  })
})

describe('session.phrase suppressNewSlide (WB-3)', () => {
  it('appends to the current slide instead of creating one while drawing', async () => {
    const before = (await act(ada, 'deck.get', { deckId })).body.slides.length

    // A plain phrase would normally spawn a new slide; suppressed, it folds
    // into the current (last) slide as transcript only.
    const ev = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'An extra remark while annotating',
      suppressNewSlide: true,
    })
    expect(ev.status).toBe(200)
    expect(ev.body.kind).toBe('slide.update')

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(before) // no new slide
    expect(view.body.slides[before - 1].sourceTranscript).toContain(
      'An extra remark while annotating',
    )
  })

  it('still creates a slide for the same phrase without the flag', async () => {
    const before = (await act(ada, 'deck.get', { deckId })).body.slides.length
    const ev = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'A brand new topic entirely',
    })
    expect(ev.body.kind).toBe('slide.new')
    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides).toHaveLength(before + 1)
  })

  it('does not change the current slide layout while drawing', async () => {
    // Make the current (last) slide a content slide with prose.
    const deck = await DeckModel.findById(deckId)
    const slide = await SlideModel.create({
      deckId,
      index: deck!.slideOrder.length,
      layoutType: 'content',
      title: 'Topic',
      body: 'Some prose',
    })
    deck!.slideOrder.push(slide._id.toString())
    await deck!.save()

    // A continuation phrase that the model would map onto a list layout must
    // NOT switch the layout while the user is drawing — the update folds in
    // and the slide keeps its content layout.
    const ev = await act(ada, 'session.phrase', {
      deckId,
      phrase: 'also another important point',
      suppressNewSlide: true,
    })
    expect(ev.body.kind).toBe('slide.update')
    expect(ev.body.slide.layoutType).toBe('content')
    const after = await SlideModel.findById(slide._id)
    expect(after?.layoutType).toBe('content')
  })
})

describe('deck.reorderSlides', () => {
  it('applies a new order and reindexes slides', async () => {
    const newOrder = [slideIds[2], slideIds[0], slideIds[1]]
    const res = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: newOrder,
    })
    expect(res.status).toBe(200)
    expect(res.body.slideOrder).toEqual(newOrder)

    const view = await act(ada, 'deck.get', { deckId })
    expect(view.body.slides.map((s: { id: string }) => s.id)).toEqual(newOrder)
  })

  it('rejects orders that are not a permutation of the current slides', async () => {
    const missing = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: [slideIds[0], slideIds[1]],
    })
    expect(missing.status).toBe(400)

    const foreignId = await act(ada, 'deck.reorderSlides', {
      deckId,
      slideOrder: [slideIds[0], slideIds[1], 'not-a-real-slide'],
    })
    expect(foreignId.status).toBe(400)
  })
})

describe('POST /slides/:slideId/image (EDIT-1)', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const uploadImage = (token: string, slideId: string, opts = {}) =>
    request(server)
      .post(`/api/slides/${slideId}/image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG, {
        filename: 'pic.png',
        contentType: 'image/png',
        ...opts,
      })

  it('stores the upload as a user-provided image with editable credit', async () => {
    // Pre-seed an AI-sourced credit that the upload must clear
    await act(ada, 'slide.editContent', {
      slideId: slideIds[0],
      attribution: { creator: 'Someone', sourceName: 'Wikimedia Commons' },
    })
    const res = await uploadImage(ada, slideIds[0]!)
    expect(res.status).toBe(201)
    expect(res.body.imageRef).toBeTruthy()
    expect(res.body.id).toBe(slideIds[0])
    // Marked user-provided (not AI 'stock') and old credit cleared
    expect(res.body.imageSource).toBe('seeded')
    expect(res.body.attribution).toBeFalsy()

    // ...and the upload also shows up as lecture seed material (SEED-2)
    const assets = await act(ada, 'seedAsset.list', { deckId })
    expect(
      assets.body.some(
        (a: { type: string; imageUrl?: string }) =>
          a.type === 'image' && a.imageUrl === res.body.imageRef,
      ),
    ).toBe(true)
  })

  it('rejects a non-image file', async () => {
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image`)
      .set('Authorization', `Bearer ${ada}`)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
    expect(res.status).toBe(400)
  })

  it("403s uploading to another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await uploadImage(bob, slideIds[0]!)
    expect(res.status).toBe(403)
  })

  it('404s for an unknown slide', async () => {
    const res = await uploadImage(ada, '0'.repeat(24))
    expect(res.status).toBe(404)
  })

  it('400s when no file is attached', async () => {
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image`)
      .set('Authorization', `Bearer ${ada}`)
    expect(res.status).toBe(400)
  })
})

describe('POST /slides/:slideId/image-candidates (EDIT-1)', () => {
  // Stub the web sources so search is deterministic and offline
  const stubImageApis = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('wikimedia')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              query: {
                pages: {
                  '1': {
                    title: 'File:Cell.png',
                    imageinfo: [
                      {
                        thumburl: 'http://wiki/cell.png',
                        thumbwidth: 1024,
                        descriptionurl: 'http://commons/cell',
                        extmetadata: { Artist: { value: 'Ada' } },
                      },
                    ],
                  },
                },
              },
            }),
          } as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [] }),
        } as Response
      }),
    )
  }

  afterEach(() => vi.unstubAllGlobals())

  it('returns ranked candidates carrying source credit', async () => {
    stubImageApis()
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-candidates`)
      .set('Authorization', `Bearer ${ada}`)
      .send({ query: 'cell' })
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0]).toMatchObject({
      url: 'http://wiki/cell.png',
      source: 'wikimedia',
    })
    expect(res.body[0].attribution).toMatchObject({
      creator: 'Ada',
      sourceName: 'Wikimedia Commons',
    })
  })

  it('searches each comma-separated phrase separately and pools them', async () => {
    // Record what each source was actually asked, and return a distinct
    // image per query so pooling across phrases is observable.
    const wikiQueries: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.hostname.includes('wikimedia')) {
          const q = url.searchParams.get('gsrsearch') ?? ''
          wikiQueries.push(q)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              query: {
                pages: {
                  '1': {
                    title: `File:${q}.png`,
                    imageinfo: [
                      { thumburl: `http://wiki/${q}.png`, thumbwidth: 1024 },
                    ],
                  },
                },
              },
            }),
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }),
    )

    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-candidates`)
      .set('Authorization', `Bearer ${ada}`)
      .send({ query: 'red cell, blue cell' })
    expect(res.status).toBe(200)
    // Each phrase queried on its own — never the joined "red cell, blue cell"
    expect(wikiQueries).toContain('red cell')
    expect(wikiQueries).toContain('blue cell')
    expect(wikiQueries).not.toContain('red cell, blue cell')
    // Results from both phrases are pooled
    const urls = res.body.map((c: { url: string }) => c.url)
    expect(urls).toContain('http://wiki/red cell.png')
    expect(urls).toContain('http://wiki/blue cell.png')
  })

  it("403s searching for another user's slide", async () => {
    const bob = await registerUser('bob-cand@example.com')
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-candidates`)
      .set('Authorization', `Bearer ${bob}`)
      .send({ query: 'cell' })
    expect(res.status).toBe(403)
  })
})

describe('POST /slides/:slideId/image-from-source (EDIT-1)', () => {
  it('sets a web image with read-only AI-sourced credit', async () => {
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-from-source`)
      .set('Authorization', `Bearer ${ada}`)
      .send({
        url: 'https://example.com/pic.jpg',
        attribution: { creator: 'Ada', sourceName: 'Wikimedia Commons' },
      })
    expect(res.status).toBe(200)
    expect(res.body.imageRef).toBe('https://example.com/pic.jpg')
    // Marked AI-sourced 'stock' so its credit stays read-only (IMG-5)
    expect(res.body.imageSource).toBe('stock')
    expect(res.body.attribution).toMatchObject({ creator: 'Ada' })
  })

  it('rejects a value that is not a URL', async () => {
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-from-source`)
      .set('Authorization', `Bearer ${ada}`)
      .send({ url: 'not-a-url' })
    expect(res.status).toBe(400)
  })

  it("403s setting another user's slide", async () => {
    const bob = await registerUser('bob-src@example.com')
    const res = await request(server)
      .post(`/api/slides/${slideIds[0]}/image-from-source`)
      .set('Authorization', `Bearer ${bob}`)
      .send({ url: 'https://example.com/pic.jpg' })
    expect(res.status).toBe(403)
  })
})
