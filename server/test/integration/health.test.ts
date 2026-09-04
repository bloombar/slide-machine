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
    expect(res.body.components).toHaveProperty('audioStorage')
    expect(res.body.components).toHaveProperty('gemini')
    expect(res.body.components).toHaveProperty('stt')
    expect(res.body.status).not.toBe('down')
  })

  /**
   * The readout exists so `TRUST_PROXY_HOPS` can be measured instead of
   * guessed, and the wrong value breaks every rate limit keyed on an address.
   * The unit tests cover the counting; these cover the wiring, which is the
   * part that can silently stop working — a handler that forgot to pass the
   * header would report zero for every request forever, and an operator
   * reading that would conclude there are no proxies at all.
   */
  it('reports how many forwarded-for entries arrived', async () => {
    const res = await request(server)
      .get('/api/health')
      .set('X-Forwarded-For', '203.0.113.7, 198.51.100.2')

    expect(res.body.proxy).toEqual({ xffEntries: 2 })
  })

  it('reports none when nothing forwarded the request', async () => {
    const res = await request(server).get('/api/health')

    expect(res.body.proxy).toEqual({ xffEntries: 0 })
  })

  // Calibration is the documented way to trust a reading: send one more entry
  // and the number must rise by exactly one. If it does not, the header is
  // not reaching the count and no reading off it means anything.
  it('rises by exactly one for one added entry', async () => {
    const clean = await request(server).get('/api/health')
    const marked = await request(server)
      .get('/api/health')
      .set('X-Forwarded-For', '0.0.0.0')

    expect(marked.body.proxy.xffEntries).toBe(clean.body.proxy.xffEntries + 1)
  })

  // The configured hop count is deliberately absent: this endpoint needs no
  // credentials, and publishing it would say which limiters are a shared
  // bucket or spoofable right now.
  it('does not publish the trust setting', async () => {
    const res = await request(server).get('/api/health')

    expect(res.body.proxy).not.toHaveProperty('trusted')
    expect(JSON.stringify(res.body)).not.toContain('trusted')
  })
})
