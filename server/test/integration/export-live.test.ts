/**
 * Integration tests for the LIVE deck export path (EXPORT_MODE=live). The
 * Google boundaries (Drive upload, Slides builder, token crypto) are mocked, so
 * this exercises the real action wiring — connection gating and dispatch to the
 * live service — without contacting Google. Direct downloads still run for real.
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

vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'live' } }
})
vi.mock('../../src/lib/export-google', () => ({
  uploadFileToDriveLive: vi.fn(async () => ({
    id: 'file-1',
    fileUrl: 'https://drive.google.com/file/d/file-1/view',
  })),
  createGoogleSlidesLive: vi.fn(async () => ({
    id: 'pres-1',
    fileUrl: 'https://docs.google.com/presentation/d/pres-1/edit',
  })),
}))
vi.mock('../../src/lib/token-crypto', () => ({
  encryptToken: vi.fn((t: string) => `enc:${t}`),
  decryptToken: vi.fn((t: string) => t.replace(/^enc:/, '')),
}))

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  uploadFileToDriveLive,
  createGoogleSlidesLive,
} from '../../src/lib/export-google'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> =>
  (
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: 'longenough1', displayName: 'x' })
  ).body.accessToken

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let adaId: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  vi.clearAllMocks()
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({ email: 'ada@example.com' }))!.id
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
    title: 'Where',
    bullets: ['Chloroplasts'],
  })
})

const connect = () =>
  UserModel.updateOne(
    { _id: adaId },
    { googleConnected: true, googleQuizRefreshToken: 'enc:refresh-token-123' },
  )

describe('export actions (live mode)', () => {
  it('does not treat a stale mock flag as connected without a token', async () => {
    await UserModel.updateOne({ _id: adaId }, { googleConnected: true })
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.googleConnected).toBe(false)
  })

  it('downloads a PDF for real even in live mode (no Google contact)', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'pdf' })
    expect(res.status).toBe(200)
    expect(
      Buffer.from(res.body.contentBase64, 'base64').subarray(0, 5).toString(),
    ).toBe('%PDF-')
    expect(uploadFileToDriveLive).not.toHaveBeenCalled()
  })

  it('uploads a YAML file to Drive through the live service', async () => {
    await connect()
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'yaml',
      driveFolderId: 'folder-1',
      driveFolderName: 'Lectures',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      fileName: 'photosynthesis.yaml',
      fileUrl: 'https://drive.google.com/file/d/file-1/view',
      driveFolderName: 'Lectures',
    })
    const [, file, folderId] = vi.mocked(uploadFileToDriveLive).mock.calls[0]!
    expect(file.mimeType).toBe('application/x-yaml')
    expect(folderId).toBe('folder-1')
  })

  it('builds a Google Slides presentation through the live service', async () => {
    await connect()
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileUrl).toBe(
      'https://docs.google.com/presentation/d/pres-1/edit',
    )
    expect(createGoogleSlidesLive).toHaveBeenCalledTimes(1)
  })

  it('forbids saving to Drive when connected but the token is gone', async () => {
    await UserModel.updateOne({ _id: adaId }, { googleConnected: true })
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })
})
