/**
 * Integration tests for the deck export actions (EXP-1/EXP-2/EXP-4) against a
 * real MongoDB, with the Google side mock-backed (EXPORT_MODE=mock). Exercises
 * status, direct PDF/YAML downloads, saving to Drive (fabricated URLs), Google
 * Slides, connection gating, and ownership enforcement — no network.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import request from 'supertest'
import YAML from 'yaml'

// Hermetic: a developer's local EXPORT_MODE=live in .env must not leak in — this
// suite exercises mock mode (fabricated Drive URLs). (QUIZ_PUBLISH_MODE is
// already pinned to mock by the vitest config, so quiz.connectGoogle connects.)
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'mock' } }
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
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let bob: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
    templateId: 'classic',
  })
  deckId = deck.body.id
  const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
  await SlideModel.create({
    deckId: deckDoc!._id,
    index: 0,
    layoutType: 'list',
    title: 'Where it happens',
    bullets: ['In chloroplasts'],
    imageRef: 'https://img/leaf.jpg',
    attribution: { creator: 'Ada', license: 'CC BY 4.0' },
  })
})

describe('export actions (mock mode)', () => {
  it('reports the deck title, connection, whiteboard, and no saved exports', async () => {
    const res = await act(ada, 'export.status', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      googleConnected: false,
      deckTitle: 'Photosynthesis',
      hasWhiteboard: false,
      exports: [],
    })
  })

  it('downloads a YAML export capturing the deck content', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'yaml' })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('photosynthesis.yaml')
    expect(res.body.mimeType).toBe('application/x-yaml')
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    const parsed = YAML.parse(yaml)
    expect(parsed.kind).toBe('deck')
    expect(parsed.title).toBe('Photosynthesis')
    expect(parsed.slides[0].image.attribution.creator).toBe('Ada')
  })

  it('downloads a real PDF export', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'pdf' })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('photosynthesis.pdf')
    expect(res.body.mimeType).toBe('application/pdf')
    const pdf = Buffer.from(res.body.contentBase64, 'base64')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('rejects an unknown download format', async () => {
    const res = await act(ada, 'export.download', {
      deckId,
      format: 'google-slides',
    })
    expect(res.status).toBe(400)
  })

  it('blocks saving to Drive until Google is connected', async () => {
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })

  it('connects, then saves a PDF to Drive, recording it on the deck', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'folder-1',
      driveFolderName: 'Lectures',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      fileId: 'mock-photosynthesis-pdf',
      fileName: 'photosynthesis.pdf',
      fileUrl: 'https://drive.google.com/file/d/mock-photosynthesis-pdf/view',
      format: 'pdf',
      driveFolderName: 'Lectures',
    })
    expect(typeof res.body.exportedAt).toBe('string')

    // It is now listed in the deck's status, and can be deleted.
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.exports).toHaveLength(1)
    expect(status.body.exports[0].fileId).toBe('mock-photosynthesis-pdf')

    const del = await act(ada, 'export.delete', {
      deckId,
      fileId: 'mock-photosynthesis-pdf',
    })
    expect(del.body).toEqual({ deleted: true })
    const after = await act(ada, 'export.status', { deckId })
    expect(after.body.exports).toEqual([])
  })

  it('exports to Google Slides (always Drive) with a presentation URL', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('Photosynthesis')
    expect(res.body.fileUrl).toBe(
      'https://docs.google.com/presentation/d/mock-photosynthesis-google-slides/edit',
    )
  })

  it('saves an untitled deck to Google Slides with a non-empty file name', async () => {
    // An empty deck title must not produce an empty file name (Mongoose's
    // `required` rejects '' — this once broke saving untitled lectures).
    await DeckModel.updateOne({ title: 'Photosynthesis' }, { title: '' })
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('Untitled lecture')
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.exports).toHaveLength(1)
  })

  it('reports hasWhiteboard when a slide carries freehand marks', async () => {
    const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
    await SlideModel.updateOne(
      { deckId: deckDoc!._id, index: 0 },
      {
        $set: {
          drawings: [
            {
              id: 's1',
              tool: 'pen',
              color: '#000000',
              thickness: 0.005,
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.4, y: 0.5 },
              ],
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              anchor: { charAnchor: 0, source: 'unsynced' },
            },
          ],
        },
      },
    )
    const res = await act(ada, 'export.status', { deckId })
    expect(res.body.hasWhiteboard).toBe(true)
  })

  it('does not let a non-editor export someone else’s deck', async () => {
    expect((await act(bob, 'export.status', { deckId })).status).toBe(403)
    expect(
      (await act(bob, 'export.download', { deckId, format: 'yaml' })).status,
    ).toBe(403)
  })
})
