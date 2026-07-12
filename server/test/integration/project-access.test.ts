/**
 * Integration tests for project-level access control and lecture
 * inheritance (SHARE-1): project settings cascade to lectures without
 * overrides; the first lecture-level change copies the project's
 * settings (copy-on-write) and isolates the lecture from later project
 * changes; resetting the override re-attaches it. One resolver serves
 * both entity types.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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

const getDeck = (slug: string, token?: string) => {
  const req = request(server).get(`/api/decks/${slug}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

let ada: string
let byron: string
let projectId: string
let deckId: string
let slug: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
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
})

describe('inheritance cascade', () => {
  it('new lectures inherit and report accessInherited', async () => {
    const view = await getDeck(slug, ada)
    expect(view.body.deck.accessInherited).toBe(true)
    expect(view.body.deck.visibility).toBe('public')
  })

  it('restricting the project cascades to inheriting lectures', async () => {
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    expect((await getDeck(slug)).status).toBe(404)
    expect((await getDeck(slug, byron)).status).toBe(404)
    // The owner still sees it; it still reports inheritance
    const owner = await getDeck(slug, ada)
    expect(owner.status).toBe(200)
    expect(owner.body.deck.visibility).toBe('restricted')
    expect(owner.body.deck.accessInherited).toBe(true)
  })

  it('project members flow through to inherited lectures', async () => {
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    await act(ada, 'project.share', {
      projectId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    expect((await getDeck(slug, byron)).status).toBe(200)

    // A project EDITOR can edit every inheriting lecture inside
    await act(ada, 'project.share', {
      projectId,
      email: 'byron@example.com',
      role: 'editor',
    })
    expect(
      (await act(byron, 'deck.rename', { deckId, title: 'Waves II' })).status,
    ).toBe(200)
    // ...and manage project-level settings, but not transfer ownership
    expect(
      (
        await act(byron, 'project.setAccess', {
          projectId,
          visibility: 'public',
        })
      ).status,
    ).toBe(200)
    const casey = await registerUser('casey@example.com')
    void casey
    expect(
      (
        await act(byron, 'project.transferOwnership', {
          projectId,
          userId: (await UserModel.findOne({
            email: 'casey@example.com',
          }))!._id!.toString(),
        })
      ).status,
    ).toBe(403)
  })
})

describe('copy-on-write overrides', () => {
  it('a lecture-level change snapshots the project settings and detaches', async () => {
    // Project has byron as viewer; lecture inherits that
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    await act(ada, 'project.share', {
      projectId,
      email: 'byron@example.com',
      role: 'viewer',
    })

    // First lecture-level change: general access to public
    const updated = await act(ada, 'deck.setAccess', {
      deckId,
      visibility: 'public',
    })
    expect(updated.body.accessInherited).toBe(false)

    // The override copied the project's people: byron is still listed
    const shares = await act(ada, 'deck.shares', { deckId })
    expect(shares.body).toEqual([
      expect.objectContaining({ email: 'byron@example.com', role: 'viewer' }),
    ])

    // Later project changes no longer touch this lecture
    await act(ada, 'project.setAccess', { projectId, visibility: 'restricted' })
    expect((await getDeck(slug)).status).toBe(200)

    // Nothing was stored on the lecture until that first change
    const raw = await DeckModel.findById(deckId)
    expect(raw!.accessOverride).toBeDefined()
  })

  it('stores nothing on lectures whose settings were never touched', async () => {
    const raw = await DeckModel.findById(deckId)
    expect(raw!.accessOverride).toBeUndefined()
  })

  it('deck.resetAccess re-attaches the lecture to its project', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    expect((await getDeck(slug)).status).toBe(404)

    const reset = await act(ada, 'deck.resetAccess', { deckId })
    expect(reset.status).toBe(200)
    expect(reset.body.accessInherited).toBe(true)
    // Project is public, so the lecture is again
    expect((await getDeck(slug)).status).toBe(200)
    expect((await DeckModel.findById(deckId))!.accessOverride).toBeUndefined()
  })
})

describe('project entity surfaces stay member-only', () => {
  it('a public project is not open to signed-in strangers', async () => {
    expect((await act(byron, 'project.get', { projectId })).status).toBe(403)
    expect((await act(byron, 'deck.list', { projectId })).status).toBe(403)
  })

  it('viewers see the project without seed notes or share lists', async () => {
    await act(ada, 'project.update', { projectId, seedContext: 'SECRET-PREP' })
    await act(ada, 'project.share', {
      projectId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const res = await act(byron, 'project.get', { projectId })
    expect(res.status).toBe(200)
    expect(res.body.seedContext).toBeUndefined()
    expect(res.body.viewers).toBeUndefined()
    expect(res.body.editors).toBeUndefined()

    // Members list the project's viewable lectures
    const list = await act(byron, 'deck.list', { projectId })
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
  })

  it('project.transferOwnership hands over; the old owner stays editor', async () => {
    const byronId = (await UserModel.findOne({
      email: 'byron@example.com',
    }))!._id!.toString()
    const res = await act(ada, 'project.transferOwnership', {
      projectId,
      userId: byronId,
    })
    expect(res.status).toBe(200)
    expect(res.body.ownerId).toBe(byronId)
    // Old owner keeps editing the project and its inheriting lectures
    expect(
      (await act(ada, 'project.update', { projectId, title: 'Physics II' }))
        .status,
    ).toBe(200)
    expect(
      (await act(ada, 'deck.rename', { deckId, title: 'Still mine to edit' }))
        .status,
    ).toBe(200)
  })
})
