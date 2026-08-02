/**
 * Integration tests for the interface locale (TECH-12): nothing is
 * stored until a language is explicitly chosen, registration can carry a
 * choice made before signing up, and `user.setLocale` sets or clears it
 * and is recorded in the settings change log.
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
  it('stores nothing when the client sends none', async () => {
    const res = await request(server).post('/api/auth/register').send(CREDS)
    expect(res.status).toBe(201)
    // No stored preference: the client follows the browser instead, and
    // re-resolves it against the supported locales on every visit
    expect(res.body.user.locale).toBeUndefined()

    const stored = await UserModel.findOne({ email: CREDS.email })
    expect(stored?.locale).toBeUndefined()
  })

  it('stores a locale the visitor explicitly chose before signing up', async () => {
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

  it('clears the stored locale back to the browser default', async () => {
    await act(token, 'user.setLocale', { locale: 'ru' })
    const res = await act(token, 'user.setLocale', { locale: null })
    expect(res.status).toBe(200)
    expect(res.body.locale).toBeUndefined()

    const stored = await UserModel.findOne({ email: CREDS.email })
    expect(stored?.locale).toBeUndefined()
  })

  it('rejects an unsupported locale, and a missing one', async () => {
    expect((await act(token, 'user.setLocale', { locale: 'de' })).status).toBe(
      400,
    )
    // null clears, but the field itself is still required — an empty
    // body is a malformed call, not a request to clear
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
    // The account had no stored locale, so the change starts from unset
    expect(entries[0]?.changes).toEqual({
      locale: { from: null, to: 'zh' },
    })
  })
})
