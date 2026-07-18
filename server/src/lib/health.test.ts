/**
 * Unit tests for health aggregation: overall-status derivation, the
 * per-probe timeout fallback, and the short-lived component cache. Every
 * probe is stubbed so no real service is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HealthComponent, HealthComponents } from '@slide-machine/shared'

const { pingMongo, storageHealthCheck, pingGemini, pingGoogleStt } = vi.hoisted(
  () => ({
    pingMongo: vi.fn(),
    storageHealthCheck: vi.fn(),
    pingGemini: vi.fn(),
    pingGoogleStt: vi.fn(),
  }),
)

vi.mock('../db/mongoose', () => ({ pingMongo }))
vi.mock('../storage', () => ({
  getStorage: () => ({ healthCheck: storageHealthCheck }),
}))
vi.mock('../providers/gemini-generation', () => ({ pingGemini }))
vi.mock('../providers/google-cloud-transcription', () => ({ pingGoogleStt }))
vi.mock('./app-version', () => ({ APP_VERSION: '2026.07.18+testsha' }))
vi.mock('../config/env', () => ({ env: { NODE_ENV: 'test' } }))

import { computeOverall, getHealth, resetHealthCache } from './health'

const ok: HealthComponent = { status: 'ok', detail: 'connected' }
const disabled: HealthComponent = { status: 'disabled', detail: 'off' }
const components = (
  over: Partial<HealthComponents> = {},
): HealthComponents => ({
  mongo: ok,
  storage: ok,
  gemini: ok,
  stt: disabled,
  ...over,
})

beforeEach(() => {
  resetHealthCache()
  pingMongo.mockResolvedValue(true)
  storageHealthCheck.mockResolvedValue(ok)
  pingGemini.mockResolvedValue(ok)
  pingGoogleStt.mockResolvedValue(disabled)
})

describe('computeOverall', () => {
  it('is ok when every active component is ok', () => {
    expect(computeOverall(components())).toBe('ok')
  })

  it('is down when mongo is down, regardless of the rest', () => {
    expect(computeOverall(components({ mongo: { status: 'down' } }))).toBe(
      'down',
    )
  })

  it('is degraded when a non-core component is down', () => {
    expect(computeOverall(components({ gemini: { status: 'down' } }))).toBe(
      'degraded',
    )
  })

  it('ignores disabled components', () => {
    expect(computeOverall(components({ stt: disabled }))).toBe('ok')
  })
})

describe('getHealth', () => {
  it('assembles the response from the probes', async () => {
    const res = await getHealth()
    expect(res.status).toBe('ok')
    expect(res.environment).toBe('test')
    expect(res.version).toBe('2026.07.18+testsha')
    expect(res.uptime).toBeGreaterThan(0)
    expect(res.components.mongo).toEqual(ok)
    expect(res.components.stt).toEqual(disabled)
  })

  it('reflects a down component in the overall status', async () => {
    pingGemini.mockResolvedValue({ status: 'down', detail: 'auth failed' })
    const res = await getHealth()
    expect(res.status).toBe('degraded')
    expect(res.components.gemini).toEqual({
      status: 'down',
      detail: 'auth failed',
    })
  })
})

describe('probe timeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('falls back to down when a probe never resolves', async () => {
    pingGemini.mockReturnValue(new Promise<HealthComponent>(() => {}))
    const pending = getHealth()
    await vi.advanceTimersByTimeAsync(2000)
    const res = await pending
    expect(res.components.gemini).toEqual({ status: 'down', detail: 'timeout' })
  })
})

describe('cache', () => {
  it('reuses probe results until the cache is reset', async () => {
    expect((await getHealth()).components.mongo.status).toBe('ok')

    // A newly-down Mongo is masked by the cache…
    pingMongo.mockResolvedValue(false)
    expect((await getHealth()).components.mongo.status).toBe('ok')

    // …until the cache is cleared.
    resetHealthCache()
    expect((await getHealth()).components.mongo.status).toBe('down')
  })
})
