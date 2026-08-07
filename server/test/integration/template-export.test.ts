/**
 * Exporting a style template to Google Drive as a Google Slides presentation
 * (EXP-6), against a real MongoDB with the Google side mock-backed.
 *
 * What the file itself contains is covered in src/lib/template-pptx.test.ts;
 * this is the action around it — who may call it, what it answers, and that
 * two exports never collide.
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

// Hermetic: a developer's local EXPORT_MODE=live must not leak in — this
// suite exercises mock mode (fabricated Drive URLs).
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'mock' } }
})

const { env } = await import('../../src/config/env')
const { connectMongo, disconnectMongo } = await import('../../src/db/mongoose')
const { createApp } = await import('../../src/app')
const { UserModel } = await import('../../src/models/user')
const { TemplateModel } = await import('../../src/models/template')
const { RefreshTokenModel } = await import('../../src/models/refresh-token')
const { listBuiltinTemplates } = await import('../../src/templates/builtin')

const server = createApp().listen(0)
afterAll(() => server.close())

const builtinId = (): string => listBuiltinTemplates()[0]!.id

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
})

describe('template.exportToDrive (EXP-6)', () => {
  it('refuses until a Google account is connected', async () => {
    const res = await act(ada, 'template.exportToDrive', {
      templateId: builtinId(),
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })

  it('saves a design to Drive as a Google Slides presentation', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.exportToDrive', {
      templateId: builtinId(),
      driveFolderId: 'folder-1',
      driveFolderName: 'Designs',
    })
    expect(res.status).toBe(200)
    expect(res.body.format).toBe('google-slides')
    expect(res.body.driveFolderName).toBe('Designs')
    // Named after the design, and opening in Slides rather than as a file
    expect(res.body.fileName).toBeTruthy()
    expect(res.body.fileUrl).toContain('/presentation/')
  })

  it('exports a design the caller authored, not only a shipped one', async () => {
    await act(ada, 'quiz.connectGoogle')
    const mine = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'My Design',
      })
    ).body
    const res = await act(ada, 'template.exportToDrive', {
      templateId: mine.id,
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('My Design')
  })

  it('gives every export its own file, so two never collide', async () => {
    await act(ada, 'quiz.connectGoogle')
    const first = await act(ada, 'template.exportToDrive', {
      templateId: builtinId(),
      driveFolderId: 'root',
    })
    const second = await act(ada, 'template.exportToDrive', {
      templateId: builtinId(),
      driveFolderId: 'root',
    })
    expect(first.body.fileId).not.toBe(second.body.fileId)
  })

  // Forbidden rather than invalid input: an unknown design and one the
  // caller may not see answer identically, so an id cannot be probed to
  // learn which it was.
  it('refuses an unknown design', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.exportToDrive', {
      templateId: 'no-such-design',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })

  it("refuses to export someone else's private design to Drive", async () => {
    const bob = await registerUser('bob@example.com')
    const owned = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    await act(bob, 'quiz.connectGoogle')
    const res = await act(bob, 'template.exportToDrive', {
      templateId: owned.body.id,
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })
})
