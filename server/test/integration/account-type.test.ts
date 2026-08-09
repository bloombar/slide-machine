/**
 * Integration tests for the account type and the privacy defaults it
 * chooses (AUTH-6 / P-1).
 *
 * Three things are checked end to end, because the rule is only useful if
 * all three hold together: the answer is stored, a student's profile turns
 * private, and a student's next project is created restricted while
 * everyone else's is public.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

// One long-lived server per file, as elsewhere in these tests.
const server = createApp().listen(0)
afterAll(() => server.close())

/** A registered account with a confirmed address, so the unverified-email
 * rule (AUTH-3) is not what makes its projects restricted. */
const registerUser = async (email: string, verified = true) => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  if (verified) await UserModel.updateOne({ email }, { emailVerified: true })
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
    ProjectModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
})

describe('user.setAccountType (AUTH-6)', () => {
  it('starts absent, which is what makes the prompt appear', async () => {
    const user = await UserModel.findOne({ email: 'ada@example.com' })
    expect(user?.accountType).toBeUndefined()
  })

  it('stores the answer and returns the updated account', async () => {
    const res = await act(ada, 'user.setAccountType', {
      accountType: 'educator',
    })
    expect(res.status).toBe(200)
    expect(res.body.accountType).toBe('educator')
    const user = await UserModel.findOne({ email: 'ada@example.com' })
    expect(user?.accountType).toBe('educator')
  })

  it('turns a student’s profile private', async () => {
    const res = await act(ada, 'user.setAccountType', {
      accountType: 'student',
    })
    expect(res.status).toBe(200)
    expect(res.body.profileVisibility).toBe('private')
  })

  it.each(['educator', 'other'])('leaves a %s profile public', async type => {
    const res = await act(ada, 'user.setAccountType', { accountType: type })
    expect(res.status).toBe(200)
    expect(res.body.profileVisibility).toBe('public')
  })

  it('does not reverse a visibility choice made after the first answer', async () => {
    await act(ada, 'user.setAccountType', { accountType: 'educator' })
    // The user then deliberately opens their profile back up... or rather,
    // deliberately closes it. Either way it is now their choice, not a default.
    await act(ada, 'user.setProfileVisibility', { profileVisibility: 'public' })

    const res = await act(ada, 'user.setAccountType', {
      accountType: 'student',
    })
    expect(res.status).toBe(200)
    expect(res.body.accountType).toBe('student')
    expect(res.body.profileVisibility).toBe('public')
  })

  it('rejects an answer that is not one of the three', async () => {
    const res = await act(ada, 'user.setAccountType', {
      accountType: 'teacher',
    })
    expect(res.status).toBe(400)
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server)
      .post('/api/actions/user.setAccountType')
      .send({ accountType: 'student' })
    expect(res.status).toBe(401)
  })

  it('records the change in the settings log', async () => {
    await act(ada, 'user.setAccountType', { accountType: 'student' })
    const entries = await SettingsChangeLogModel.find({ entityType: 'user' })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.changes).toMatchObject({
      accountType: { to: 'student' },
      profileVisibility: { from: 'public', to: 'private' },
    })
  })
})

describe('project defaults follow the account type (AUTH-6 / P-1)', () => {
  const createProject = async (token: string) => {
    const res = await act(token, 'project.create', { title: 'Bio 101' })
    expect(res.status).toBe(200)
    return res.body as { id: string; visibility: string }
  }

  it('creates a student’s project restricted', async () => {
    await act(ada, 'user.setAccountType', { accountType: 'student' })
    expect((await createProject(ada)).visibility).toBe('restricted')
  })

  it.each(['educator', 'other'])(
    'creates a %s’s project public',
    async type => {
      await act(ada, 'user.setAccountType', { accountType: type })
      expect((await createProject(ada)).visibility).toBe('public')
    },
  )

  it('creates a project public when the question is still unanswered', async () => {
    expect((await createProject(ada)).visibility).toBe('public')
  })

  it('keeps the unverified-email rule as well: whichever is stricter wins', async () => {
    const byron = await registerUser('byron@example.com', false)
    await act(byron, 'user.setAccountType', { accountType: 'educator' })
    expect((await createProject(byron)).visibility).toBe('restricted')
  })

  it('does not re-scope projects that already exist', async () => {
    const before = await createProject(ada)
    await act(ada, 'user.setAccountType', { accountType: 'student' })
    const still = await ProjectModel.findById(before.id)
    expect(still?.visibility).toBe('public')
  })

  it('follows a later change of account type', async () => {
    await act(ada, 'user.setAccountType', { accountType: 'student' })
    expect((await createProject(ada)).visibility).toBe('restricted')
    await act(ada, 'user.setAccountType', { accountType: 'educator' })
    expect((await createProject(ada)).visibility).toBe('public')
  })
})
