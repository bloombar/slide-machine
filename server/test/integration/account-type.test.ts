/**
 * Integration tests for the account type (AUTH-6).
 *
 * It is a self-declaration and nothing more. It once chose the privacy
 * defaults an account's work started from, which meant a signed-in account
 * met a modal before it could do anything and a student's lectures were
 * created restricted; the defaults are the same for everyone again.
 *
 * What is checked is therefore mostly that nothing follows from it: saying
 * "student" changes no visibility, and a project's own rule — an
 * unconfirmed address (AUTH-3) — is the only thing that still restricts
 * one.
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
  it('starts absent, because an account need never say what it is', async () => {
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

  it.each(['student', 'educator', 'other'])(
    'leaves a %s profile exactly as it was',
    async type => {
      const res = await act(ada, 'user.setAccountType', { accountType: type })
      expect(res.status).toBe(200)
      // Saying what you are is not a privacy decision. It used to turn a
      // student's profile private, which is a choice they never made.
      expect(res.body.profileVisibility).toBe('public')
    },
  )

  it('leaves a visibility choice the account made alone', async () => {
    await act(ada, 'user.setProfileVisibility', {
      profileVisibility: 'private',
    })
    const res = await act(ada, 'user.setAccountType', {
      accountType: 'educator',
    })
    expect(res.status).toBe(200)
    expect(res.body.profileVisibility).toBe('private')
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
    })
    // Nothing else moved with it.
    expect(entries[0]!.changes).not.toHaveProperty('profileVisibility')
  })
})

describe('what a new project starts as (AUTH-3)', () => {
  const createProject = async (token: string) => {
    const res = await act(token, 'project.create', { title: 'Bio 101' })
    expect(res.status).toBe(200)
    return res.body as { id: string; visibility: string }
  }

  it.each(['student', 'educator', 'other'])(
    'creates a %s’s project public, as it does everyone’s',
    async type => {
      await act(ada, 'user.setAccountType', { accountType: type })
      expect((await createProject(ada)).visibility).toBe('public')
    },
  )

  it('creates a project public when the question is unanswered', async () => {
    expect((await createProject(ada)).visibility).toBe('public')
  })

  it('still restricts one for an address nobody has confirmed', async () => {
    // The rule that survives: publishing on behalf of an account nobody has
    // proved they own is publishing without ever being asked (AUTH-3).
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
})
