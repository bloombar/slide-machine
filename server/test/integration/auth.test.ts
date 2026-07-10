/**
 * Integration tests for the auth routes against a real MongoDB:
 * registration, login, session refresh with rotation, and logout.
 * REFRESH_GRACE_SECONDS=0 in the test env, so rotated-out tokens die
 * immediately.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { signAccessToken } from '../../src/auth/tokens'

const app = createApp()
const CREDS = {
  email: 'ada@example.com',
  password: 'longenough1',
  displayName: 'Ada',
}

/** Extracts the sm_refresh cookie string from a response, if set. */
const refreshCookie = (res: request.Response): string | undefined =>
  res.get('Set-Cookie')?.find((c: string) => c.startsWith('sm_refresh='))

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), RefreshTokenModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
})

describe('POST /api/auth/register', () => {
  it('creates the account, returns user + access token, sets the refresh cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(CREDS)

    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({
      email: CREDS.email,
      displayName: 'Ada',
    })
    expect(res.body.user).not.toHaveProperty('passwordHash')
    expect(res.body.accessToken).toBeTruthy()

    const cookie = refreshCookie(res)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/api/auth')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('rejects duplicate emails, including case variants, with 409', async () => {
    await request(app).post('/api/auth/register').send(CREDS)
    const dup = await request(app)
      .post('/api/auth/register')
      .send({ ...CREDS, email: 'ADA@example.com' })

    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('email_taken')
  })

  it('rejects invalid input with details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(res.body.error.details?.length).toBeGreaterThan(0)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(CREDS)
  })

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDS.email, password: CREDS.password })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(refreshCookie(res)).toBeTruthy()
  })

  it('returns the same 401 for wrong password and unknown email', async () => {
    const wrongPw = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDS.email, password: 'incorrect1' })
    const noUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever1' })

    expect(wrongPw.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(wrongPw.body.error.code).toBe('invalid_credentials')
    expect(noUser.body.error.code).toBe('invalid_credentials')
  })
})

describe('GET /api/auth/me', () => {
  it('returns the user with a valid token and 401 without one', async () => {
    const reg = await request(app).post('/api/auth/register').send(CREDS)

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
    expect(me.status).toBe(200)
    expect(me.body.email).toBe(CREDS.email)

    expect((await request(app).get('/api/auth/me')).status).toBe(401)
  })

  it('rejects expired access tokens', async () => {
    const reg = await request(app).post('/api/auth/register').send(CREDS)
    const expired = await signAccessToken(reg.body.user.id, -10)

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_token')
  })
})

describe('POST /api/auth/refresh', () => {
  it('rotates the token: new cookie works, replayed old cookie fails', async () => {
    const reg = await request(app).post('/api/auth/register').send(CREDS)
    const oldCookie = refreshCookie(reg)!

    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
    expect(first.status).toBe(200)
    expect(first.body.user.email).toBe(CREDS.email)
    expect(first.body.accessToken).toBeTruthy()
    const newCookie = refreshCookie(first)!
    expect(newCookie).not.toBe(oldCookie)

    // Grace is 0 in tests: the rotated-out token must be dead immediately
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
    expect(replay.status).toBe(401)

    const second = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', newCookie)
    expect(second.status).toBe(200)
  })

  it('honors a positive grace window on the rotated-out token', async () => {
    const reg = await request(app).post('/api/auth/register').send(CREDS)
    const oldCookie = refreshCookie(reg)!
    await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)

    // Simulate a grace window by extending the (now-shortened) old record
    await RefreshTokenModel.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() + 60000) } },
    )
    const withinGrace = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
    expect(withinGrace.status).toBe(200)
  })

  it('401s with no cookie', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie; idempotent', async () => {
    const reg = await request(app).post('/api/auth/register').send(CREDS)
    const cookie = refreshCookie(reg)!

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
    expect(out.status).toBe(204)
    expect(refreshCookie(out)).toContain('sm_refresh=;')

    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', cookie))
        .status,
    ).toBe(401)
    expect((await request(app).post('/api/auth/logout')).status).toBe(204)
  })
})
