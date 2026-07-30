/**
 * Integration tests for the interface locale (TECH-12): the account
 * always has one, registration can carry the browser-detected value, and
 * `user.setLocale` changes it and is recorded in the settings change log.
 *
 * The interface locale and the lecturing language are deliberately
 * independent — see language.test.ts for the other one — so this file
 * also pins that changing either leaves the other alone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

const server = createApp().listen(0)
afterAll(() => server.close())

const CREDS = {
  email: 'ada@example.com',
  password: 'longenough1',
  displayName: 'Ada',
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

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
    RefreshTokenModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
})

describe('registration locale', () => {
  it('defaults to English when the client sends none', async () => {
    const res = await request(server).post('/api/auth/register').send(CREDS)
    expect(res.status).toBe(201)
    expect(res.body.user.locale).toBe('en')
  })

  it('stores the browser-detected locale the client sends', async () => {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ ...CREDS, locale: 'fr' })
    expect(res.status).toBe(201)
    expect(res.body.user.locale).toBe('fr')

    // Persisted, not just echoed: the next session restore reads it
    const me = await request(server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
    expect(me.body.locale).toBe('fr')
  })

  it('rejects a locale outside the supported set', async () => {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ ...CREDS, locale: 'de' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })
})

describe('user.setLocale', () => {
  let token: string

  beforeEach(async () => {
    const res = await request(server).post('/api/auth/register').send(CREDS)
    token = res.body.accessToken as string
  })

  it('changes the interface locale and returns the updated account', async () => {
    const res = await act(token, 'user.setLocale', { locale: 'ru' })
    expect(res.status).toBe(200)
    expect(res.body.locale).toBe('ru')

    const stored = await UserModel.findOne({ email: CREDS.email })
    expect(stored?.locale).toBe('ru')
  })

  it('rejects an unsupported locale, and a missing one', async () => {
    expect((await act(token, 'user.setLocale', { locale: 'de' })).status).toBe(
      400,
    )
    // Unlike the lecturing language there is nothing to clear back to,
    // so null is not a valid value either
    expect((await act(token, 'user.setLocale', { locale: null })).status).toBe(
      400,
    )
    expect((await act(token, 'user.setLocale')).status).toBe(400)
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await request(server)
      .post('/api/actions/user.setLocale')
      .send({ locale: 'es' })
    expect(res.status).toBe(401)
  })

  it('leaves the lecturing language alone, and vice versa', async () => {
    await act(token, 'user.setLanguage', { language: 'es' })
    const afterLocale = await act(token, 'user.setLocale', { locale: 'ru' })
    expect(afterLocale.body.locale).toBe('ru')
    expect(afterLocale.body.language).toBe('es')

    const afterLanguage = await act(token, 'user.setLanguage', {
      language: null,
    })
    expect(afterLanguage.body.locale).toBe('ru')
    expect(afterLanguage.body.language).toBeUndefined()
  })

  it('records the change in the settings change log', async () => {
    await act(token, 'user.setLocale', { locale: 'zh' })

    const entries = await SettingsChangeLogModel.find({ entityType: 'user' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.actorRole).toBe('owner')
    expect(entries[0]?.changes).toEqual({
      locale: { from: 'en', to: 'zh' },
    })
  })
})
