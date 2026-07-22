/**
 * Unit tests for health aggregation: overall-status derivation, the
 * per-probe timeout fallback, and the short-lived component cache. Every
 * probe is stubbed so no real service is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HealthComponent, HealthComponents } from '@slide-machine/shared'

const {
  pingMongo,
  storageHealthCheck,
  pingGcsAudioStorage,
  pingGemini,
  pingGoogleStt,
  pingGoogleTts,
} = vi.hoisted(() => ({
  pingMongo: vi.fn(),
  storageHealthCheck: vi.fn(),
  pingGcsAudioStorage: vi.fn(),
  pingGemini: vi.fn(),
  pingGoogleStt: vi.fn(),
  pingGoogleTts: vi.fn(),
}))

vi.mock('../db/mongoose', () => ({ pingMongo }))
vi.mock('../storage', () => ({
  getStorage: () => ({ healthCheck: storageHealthCheck }),
}))
vi.mock('../providers/gemini-generation', () => ({ pingGemini }))
vi.mock('../providers/google-cloud-transcription', () => ({ pingGoogleStt }))
vi.mock('../providers/google-cloud-tts', () => ({ pingGoogleTts }))
vi.mock('../providers/google-cloud-diarization', () => ({ pingGcsAudioStorage }))
vi.mock('./app-version', () => ({ APP_VERSION: '2026.07.18+testsha' }))
vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', TTS_PROVIDER: 'google-cloud' },
}))

import { computeOverall, getHealth, resetHealthCache } from './health'

const ok: HealthComponent = { status: 'ok', detail: 'connected' }
const disabled: HealthComponent = { status: 'disabled', detail: 'off' }
const components = (
  over: Partial<HealthComponents> = {},
): HealthComponents => ({
  mongo: ok,
  storage: ok,
  audioStorage: disabled,
  gemini: ok,
  stt: disabled,
  tts: disabled,
  ...over,
})

beforeEach(() => {
  resetHealthCache()
  pingMongo.mockResolvedValue(true)
  storageHealthCheck.mockResolvedValue(ok)
  pingGcsAudioStorage.mockResolvedValue(disabled)
  pingGemini.mockResolvedValue(ok)
  pingGoogleStt.mockResolvedValue(disabled)
  pingGoogleTts.mockResolvedValue(disabled)
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
    expect(res.components.audioStorage).toEqual(disabled)
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
