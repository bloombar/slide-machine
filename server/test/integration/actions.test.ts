/**
 * Integration tests for the actions endpoint: authentication, ownership
 * isolation between users, and dispatch error mapping.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
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
  // These accounts are ordinary users of a running app, so their address is
  // confirmed: an unconfirmed one keeps its projects restricted (AUTH-3).
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), ProjectModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
})

describe('POST /api/actions/:name', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(server)
      .post('/api/actions/project.create')
      .send({ title: 'Sneaky' })
    expect(res.status).toBe(401)
  })

  it('creates and lists projects scoped to the owner', async () => {
    const ada = await registerUser('ada@example.com')
    const bob = await registerUser('bob@example.com')

    const created = await act(ada, 'project.create', {
      title: 'Bio 101',
      course: 'BIO-101',
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ title: 'Bio 101', course: 'BIO-101' })

    const adaList = await act(ada, 'project.list')
    expect(adaList.body).toHaveLength(1)

    const bobList = await act(bob, 'project.list')
    expect(bobList.body).toHaveLength(0)
  })

  it("403s deleting another user's project without leaking existence", async () => {
    const ada = await registerUser('ada@example.com')
    const bob = await registerUser('bob@example.com')
    const created = await act(ada, 'project.create', { title: 'Mine' })

    const foreign = await act(bob, 'project.delete', {
      projectId: created.body.id,
    })
    expect(foreign.status).toBe(403)
    expect(foreign.body.error.code).toBe('forbidden')

    const own = await act(ada, 'project.delete', { projectId: created.body.id })
    expect(own.status).toBe(200)
    expect((await act(ada, 'project.list')).body).toHaveLength(0)
  })

  it('project.get returns own projects and 403s foreign restricted ones', async () => {
    const ada = await registerUser('ada@example.com')
    const bob = await registerUser('bob@example.com')
    const created = await act(ada, 'project.create', { title: 'Mine' })
    // A public project is browsable by anyone (SOC); restrict it so the
    // ownership gate is what's under test here.
    await act(ada, 'project.setAccess', {
      projectId: created.body.id,
      visibility: 'restricted',
    })

    const own = await act(ada, 'project.get', { projectId: created.body.id })
    expect(own.status).toBe(200)
    expect(own.body.title).toBe('Mine')

    const foreign = await act(bob, 'project.get', {
      projectId: created.body.id,
    })
    expect(foreign.status).toBe(403)
  })

  it('project.get names the owner, for the page byline', async () => {
    const ada = await registerUser('ada@example.com')
    const bob = await registerUser('bob@example.com')
    const created = await act(ada, 'project.create', { title: 'Mine' })

    const own = await act(ada, 'project.get', { projectId: created.body.id })
    expect(own.body.owner).toEqual({
      id: own.body.ownerId,
      displayName: 'ada',
    })

    // A public project is browsable by anyone: whose it is comes along,
    // even though seed notes and people lists do not.
    const visitor = await act(bob, 'project.get', {
      projectId: created.body.id,
    })
    expect(visitor.status).toBe(200)
    expect(visitor.body.owner.displayName).toBe('ada')
    expect(visitor.body.seedContext).toBeUndefined()

    // The list stays lean: no per-row user lookup
    const list = await act(ada, 'project.list')
    expect(list.body[0].owner).toBeUndefined()
  })

  it('404s unknown actions and 400s invalid input', async () => {
    const ada = await registerUser('ada@example.com')

    expect((await act(ada, 'no.such.action')).status).toBe(404)

    // A non-string title fails the schema (empty is allowed — see below)
    const bad = await act(ada, 'project.create', { title: 42 })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_input')
  })

  it('creates a titleless default project when no title is given', async () => {
    const ada = await registerUser('ada@example.com')

    // The client makes one of these on the fly for a user's first lecture;
    // the empty title is shown under a placeholder name in the interface.
    const created = await act(ada, 'project.create', {})
    expect(created.status).toBe(200)
    expect(created.body.title).toBe('')

    const listed = await act(ada, 'project.list')
    expect(listed.body).toHaveLength(1)
    expect(listed.body[0].title).toBe('')
  })
})
