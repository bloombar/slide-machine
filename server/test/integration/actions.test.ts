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

const app = createApp()

const registerUser = async (email: string): Promise<string> => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(app)
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
    const res = await request(app)
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

  it('404s unknown actions and 400s invalid input', async () => {
    const ada = await registerUser('ada@example.com')

    expect((await act(ada, 'no.such.action')).status).toBe(404)

    const bad = await act(ada, 'project.create', { title: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_input')
  })
})
