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

  it('reports the component breakdown with Mongo connected', async () => {
    const res = await request(server).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.environment).toBe('test')
    expect(typeof res.body.version).toBe('string')
    expect(res.body.version.length).toBeGreaterThan(0)
    expect(res.body.uptime).toBeGreaterThan(0)

    // Mongo is live in this suite, so the core is up and the overall status
    // is never `down`. (Whether the paid AI providers are configured varies
    // by local .env, so we don't pin them to a specific status here.)
    expect(res.body.components.mongo).toMatchObject({ status: 'ok' })
    expect(res.body.components).toHaveProperty('storage')
    expect(res.body.components).toHaveProperty('gemini')
    expect(res.body.components).toHaveProperty('stt')
    expect(res.body.status).not.toBe('down')
  })
})
