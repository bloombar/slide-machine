/**
 * "This is not yours" and "your account is not set up for this" are different
 * answers (SPEC TECH-14).
 *
 * Both were `ActionForbiddenError` with the same 403 and only the message text
 * to tell them apart, so a client could not decide whether to show a Connect
 * button without matching on prose. `capability_required` makes the difference
 * machine-readable, and this is where it becomes observable to a client.
 *
 * The order is the other half of it: the resource is settled first, so someone
 * with no rights to a lecture is refused outright rather than invited to
 * connect an account they were never going to be allowed to use.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { listBuiltinTemplates } from '../../src/templates/builtin'
import { act, registerUser, startServer } from './helpers/actions'

const server = startServer()
afterAll(() => server.close())

const builtinId = (): string => listBuiltinTemplates()[0]!.id

let ada: string
let bob: string
let deckId: string

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser(server, 'ada@example.com')
  bob = await registerUser(server, 'bob@example.com')

  const project = await act(server, ada, 'project.create', { title: 'Bio' })
  const deck = await act(server, ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
  })
  deckId = deck.body.id
})

describe('an account with no Google connection', () => {
  // Its own code, so the client can offer the fix rather than report a wall.
  it.each([
    ['quiz.publish', { driveFolderId: 'root' }],
    ['quiz.generate', {}],
    ['export.toDrive', { format: 'pdf', driveFolderId: 'root' }],
  ])(
    'is told to connect one for %s on its own lecture',
    async (name, extra) => {
      const res = await act(server, ada, name, { deckId, ...extra })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('capability_required')
      expect(res.body.error.details).toEqual(['google-drive'])
    },
  )

  it('is told to connect one for actions that name no lecture', async () => {
    const res = await act(server, ada, 'quiz.driveFolders')
    expect(res.body.error.code).toBe('capability_required')
  })
})

describe('an account with one, reaching for a lecture that is not theirs', () => {
  // The resource is settled first: bob is refused for the lecture, and never
  // told anything about his account, which is fine.
  it.each([
    ['quiz.publish', { driveFolderId: 'root' }],
    ['quiz.generate', {}],
    ['export.toDrive', { format: 'pdf', driveFolderId: 'root' }],
  ])('is refused outright for %s', async (name, extra) => {
    await act(server, bob, 'quiz.connectGoogle')
    const res = await act(server, bob, name, { deckId, ...extra })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
  })
})

describe('the two are never confused', () => {
  it('answers the same status with different codes', async () => {
    const noAccount = await act(server, ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    await act(server, bob, 'quiz.connectGoogle')
    const noRights = await act(server, bob, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })

    expect(noAccount.status).toBe(noRights.status)
    expect(noAccount.body.error.code).not.toBe(noRights.body.error.code)
  })

  // Reading a design and reaching Drive are separate requirements, and the
  // design is checked first.
  it('refuses a foreign private design before asking about Drive', async () => {
    const adas = await act(server, ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    const res = await act(server, bob, 'template.exportToDrive', {
      templateId: adas.body.id,
      driveFolderId: 'root',
    })
    expect(res.body.error.code).toBe('forbidden')
  })

  it('asks about Drive once the design is readable', async () => {
    const res = await act(server, bob, 'template.exportToDrive', {
      templateId: builtinId(),
      driveFolderId: 'root',
    })
    expect(res.body.error.code).toBe('capability_required')
  })
})

describe('actions that report a connection without needing one', () => {
  it.each(['quiz.status', 'export.status'])(
    '%s answers for a disconnected account',
    async name => {
      const res = await act(server, ada, name, { deckId })
      expect(res.status).toBe(200)
      expect(res.body.googleConnected).toBe(false)
    },
  )

  it('reports it as connected once it is', async () => {
    await act(server, ada, 'quiz.connectGoogle')
    const res = await act(server, ada, 'quiz.status', { deckId })
    expect(res.body.googleConnected).toBe(true)
  })
})
