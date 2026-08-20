/**
 * Integration tests for GET /api/admin/cost/prices (BILL-7): the in-use price
 * list is served from the deployment's real config file and admin-gated like
 * the rest of the cost API. Which services survive the gates depends on env
 * that the developer's .env legitimately leaks into (TTS keys and the like),
 * so the gating logic itself is asserted in the hermetic unit tests
 * (src/billing/configured-prices.test.ts); here the wiring and the contract.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { ServicePricesResponse } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { loadServicePrices } from '../../src/config/service-prices'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
})

describe('GET /api/admin/cost/prices', () => {
  it('serves well-formed rates stamped from the real config file', async () => {
    const admin = await registerUser(ADMIN_EMAIL)

    const res = await request(server)
      .get('/api/admin/cost/prices')
      .set('Authorization', `Bearer ${admin}`)

    expect(res.status).toBe(200)
    const body = res.body as ServicePricesResponse
    // Stamped from the same config file the deployment prices events with.
    const config = loadServicePrices(env.SERVICE_PRICES_PATH)
    expect(body.asOf).toBe(config.asOf)
    expect(body.currency).toBe(config.currency)
    // Generation and quizzes are mocked in tests, so whatever else the local
    // env switches on, no AI rate is in use here.
    expect(Array.isArray(body.prices)).toBe(true)
    const services = body.prices.map(line => line.service)
    expect(services).not.toContain('AI generation')
    expect(services).not.toContain('Embeddings')
    for (const line of body.prices) {
      expect(line.service).toBeTruthy()
      expect(line.unit).toBeTruthy()
      expect(line.rate).toBeGreaterThanOrEqual(0)
      expect(['currency', 'percent']).toContain(line.kind)
    }
  })

  it('is admin-gated like the rest of the cost API', async () => {
    const user = await registerUser('ada@example.com')

    const anonymous = await request(server).get('/api/admin/cost/prices')
    expect(anonymous.status).toBe(401)

    const nonAdmin = await request(server)
      .get('/api/admin/cost/prices')
      .set('Authorization', `Bearer ${user}`)
    expect(nonAdmin.status).toBe(403)
  })
})
