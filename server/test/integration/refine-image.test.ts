/**
 * Integration test: refining a slide whose layout has an empty image slot
 * sources an image via the same enrichment pipeline as every other automatic
 * fetch (GEN-4). Image enrichment is enabled here (off in the base test env),
 * AI re-rank is off so the heuristic top result is used, and the image search
 * is stubbed. MongoDB real.
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

vi.mock('../../src/config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      IMAGE_ENRICHMENT_ENABLED: true,
      IMAGE_RERANK_ENABLED: false,
    },
  }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
import { RefineJobModel } from '../../src/models/refine-job'
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

/** A Wikimedia hit for "mitochondria"; every other source returns empty. */
const stubImageApis = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('wikimedia'))
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
                    },
                  ],
                },
              },
            },
          }),
        } as Response
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

const awaitJob = (jobId: string) =>
  vi.waitFor(
    async () => {
      const res = await act(ada, 'deck.refineStatus', { jobId })
      expect(res.body.status).toBe('done')
    },
    { timeout: 5000, interval: 50 },
  )

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(disconnectMongo)

afterEach(() => vi.unstubAllGlobals())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefineJobModel.deleteMany({}),
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

describe('deck.refine image enrichment', () => {
  it('sources an image for a refined slide with an empty image slot', async () => {
    // A two-column slide (has an image slot) with keywords but no image.
    const slide = await SlideModel.create({
      deckId: new Types.ObjectId(deckId),
      index: 0,
      layoutType: 'two-column',
      title: 'The Mitochondria',
      body: 'The powerhouse of the cell',
      imageKeywords: ['mitochondria'],
    })
    stubImageApis()

    const start = await act(ada, 'deck.refine', {
      deckId,
      refineSlides: { level: 2 },
    })
    await awaitJob(start.body.jobId)

    // The refine both stamped the slide (caption) and sourced its image.
    const updated = await SlideModel.findById(slide._id)
    expect(updated?.caption).toBe('Refined (level 2)')
    expect(updated?.imageRef).toBe('http://wiki/mitochondria.png')
  })
})
