/**
 * Integration test: the health endpoint against a real Express app and a
 * real MongoDB (MONGODB_TEST_URI, defaulting to a local test database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'

const server = createApp().listen(0)

describe('GET /api/health', () => {
  beforeAll(async () => {
    await connectMongo(env.MONGODB_URI)
  })

  afterAll(async () => {
    await disconnectMongo()
    server.close()
  })

  it('reports ok with Mongo connected', async () => {
    const res = await request(server).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', mongo: 'connected' })
    expect(res.body.uptime).toBeGreaterThan(0)
  })
})
