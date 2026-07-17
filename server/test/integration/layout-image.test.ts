/**
 * Integration tests for on-demand image sourcing (EDIT-3 + IMG-1): moving
 * a slide onto a layout with an image slot, while it has no image yet,
 * derives search keywords from the slide's text and runs background
 * enrichment. Text-only layouts and slides that already have an image are
 * left alone.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
  afterEach,
} from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import type { LayoutType } from '@slide-machine/shared'

// Same validated env, with image enrichment forced on (the suite pins it
// off by default; this file exercises the enrichment path)
vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, IMAGE_ENRICHMENT_ENABLED: true },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

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

/** A Wikimedia hit for "mitochondria"; every other source returns empty. */
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
                  title: 'File:Mitochondria.png',
                  imageinfo: [
                    {
                      thumburl: 'http://wiki/mitochondria.png',
                      thumbwidth: 1024,
                      extmetadata: { Artist: { value: 'Jane' } },
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

let ada: string
let deckId: string

/** Creates a slide directly (bypassing generation) so the test controls
 * the starting layout, text, and image state exactly. */
const makeSlide = async (fields: {
  layoutType: LayoutType
  title?: string
  imageRef?: string
  imageKeywords?: string[]
}): Promise<string> => {
  const slide = await SlideModel.create({
    deckId: new Types.ObjectId(deckId),
    index: 0,
    ...fields,
  })
  return slide._id.toString()
}

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})

afterAll(async () => {
  await disconnectMongo()
})

afterEach(() => {
  vi.unstubAllGlobals()
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
})

describe('slide.setLayout image sourcing', () => {
  it('derives keywords and sources an image when moving onto an image layout', async () => {
    const slideId = await makeSlide({
      layoutType: 'content',
      title: 'The Mitochondria',
    })
    stubImageApis()

    const res = await act(ada, 'slide.setLayout', {
      slideId,
      layoutType: 'image-heavy',
    })
    expect(res.status).toBe(200)
    expect(res.body.layoutType).toBe('image-heavy')
    // Keywords derived from the slide's own text, persisted for the client
    expect(res.body.imageKeywords).toEqual(['mitochondria'])
    expect(res.body.imageRef).toBeUndefined()

    // Background enrichment lands the image; the client picks it up via slide.get
    await vi.waitFor(async () => {
      const slide = await act(ada, 'slide.get', { slideId })
      expect(slide.body.imageRef).toBe('http://wiki/mitochondria.png')
      expect(slide.body.imageSource).toBe('stock')
    })
  })

  it('does not source an image for a text-only layout', async () => {
    const slideId = await makeSlide({
      layoutType: 'content',
      title: 'The Mitochondria',
    })
    stubImageApis()

    const res = await act(ada, 'slide.setLayout', {
      slideId,
      layoutType: 'list',
    })
    expect(res.status).toBe(200)
    expect(res.body.layoutType).toBe('list')
    expect(res.body.imageKeywords).toBeUndefined()

    const slide = await act(ada, 'slide.get', { slideId })
    expect(slide.body.imageRef).toBeUndefined()
  })

  it('leaves an existing image untouched when switching image layouts', async () => {
    const slideId = await makeSlide({
      layoutType: 'image-heavy',
      title: 'The Mitochondria',
      imageRef: 'http://original.png',
      imageKeywords: ['mitochondria'],
    })
    stubImageApis()

    const res = await act(ada, 'slide.setLayout', {
      slideId,
      layoutType: 'two-column',
    })
    expect(res.status).toBe(200)
    expect(res.body.layoutType).toBe('two-column')
    expect(res.body.imageRef).toBe('http://original.png')

    // Give any (unwanted) background enrichment a chance to run, then confirm
    // the original image was never overwritten
    await new Promise(resolve => setTimeout(resolve, 50))
    const slide = await act(ada, 'slide.get', { slideId })
    expect(slide.body.imageRef).toBe('http://original.png')
  })

  it('leaves a textless slide without keywords or an image', async () => {
    const slideId = await makeSlide({ layoutType: 'content' })
    stubImageApis()

    const res = await act(ada, 'slide.setLayout', {
      slideId,
      layoutType: 'image-heavy',
    })
    expect(res.status).toBe(200)
    expect(res.body.imageKeywords).toBeUndefined()
    expect(res.body.imageRef).toBeUndefined()
  })
})
