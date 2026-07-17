/**
 * Integration tests: enrichSlideImage persists onto a real slide (with
 * stubbed image APIs), never overwrites, and slide.get exposes the
 * result with ownership enforced.
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
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { enrichSlideImage } from '../../src/enrichment/enrich'
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
let slideId: string

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
  const event = await act(ada, 'session.phrase', {
    deckId: deck.body.id,
    phrase: 'The mitochondria is the powerhouse of the cell as everyone knows',
  })
  slideId = event.body.slide.id
})

describe('enrichSlideImage', () => {
  it('persists the winning image onto the slide', async () => {
    stubImageApis()
    await enrichSlideImage(slideId, ['mitochondria'])

    const slide = await act(ada, 'slide.get', { slideId })
    expect(slide.status).toBe(200)
    expect(slide.body.imageRef).toBe('http://wiki/mitochondria.png')
    expect(slide.body.imageSource).toBe('stock')
    // AI-sourced images arrive with credit AND a source link pre-filled
    // (IMG-5), the source built from the Commons file page
    expect(slide.body.attribution).toMatchObject({
      author: 'Jane (Wikimedia Commons)',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mitochondria.png',
    })
  })

  it('never overwrites an existing image (IMG-3 stability)', async () => {
    await SlideModel.updateOne(
      { _id: slideId },
      { imageRef: 'http://original.png' },
    )
    stubImageApis()
    await enrichSlideImage(slideId, ['mitochondria'])

    const slide = await act(ada, 'slide.get', { slideId })
    expect(slide.body.imageRef).toBe('http://original.png')
  })

  it('leaves the slide untouched when enrichment finds nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ results: [] }),
          }) as Response,
      ),
    )
    await enrichSlideImage(slideId, ['mitochondria'])

    const slide = await act(ada, 'slide.get', { slideId })
    expect(slide.body.imageRef).toBeUndefined()
  })

  it("slide.get 403s another user's slide", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'slide.get', { slideId })
    expect(res.status).toBe(403)
  })
})
