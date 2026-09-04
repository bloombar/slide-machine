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
  pingGoogleTranslation,
} = vi.hoisted(() => ({
  pingMongo: vi.fn(),
  storageHealthCheck: vi.fn(),
  pingGcsAudioStorage: vi.fn(),
  pingGemini: vi.fn(),
  pingGoogleStt: vi.fn(),
  pingGoogleTts: vi.fn(),
  pingGoogleTranslation: vi.fn(),
}))

vi.mock('../db/mongoose', () => ({ pingMongo }))
vi.mock('../storage', () => ({
  getStorage: () => ({ healthCheck: storageHealthCheck }),
}))
vi.mock('../providers/gemini-generation', () => ({ pingGemini }))
vi.mock('../providers/google-cloud-transcription', () => ({ pingGoogleStt }))
vi.mock('../providers/google-cloud-tts', () => ({ pingGoogleTts }))
vi.mock('../providers/google-cloud-translation', () => ({
  pingGoogleTranslation,
}))
vi.mock('../providers/google-cloud-diarization', () => ({
  pingGcsAudioStorage,
}))
vi.mock('./app-version', () => ({ APP_VERSION: '2026.07.18+testsha' }))
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    TTS_PROVIDER: 'google-cloud',
    TRANSLATION_PROVIDER: 'google-cloud',
  },
}))

import {
  computeOverall,
  getHealth,
  resetHealthCache,
  xffEntryCount,
} from './health'

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
  translation: disabled,
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
  pingGoogleTranslation.mockResolvedValue(disabled)
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

describe('xffEntryCount', () => {
  // The count is the whole point: it is what `TRUST_PROXY_HOPS` has to match,
  // and getting it wrong breaks every rate limit keyed on an address.
  it('counts the entries named in the header', () => {
    expect(xffEntryCount('203.0.113.7')).toBe(1)
    expect(xffEntryCount('203.0.113.7, 198.51.100.2')).toBe(2)
    expect(xffEntryCount('203.0.113.7, 198.51.100.2, 192.0.2.9')).toBe(3)
  })

  // Splitting on ', ' rather than ',' passes every other case here and
  // returns 1 for this one — a legal header several proxies emit, and an
  // off-by-one that would land straight in TRUST_PROXY_HOPS.
  it('counts entries a proxy wrote without a space after the comma', () => {
    expect(xffEntryCount('203.0.113.7,198.51.100.2')).toBe(2)
    expect(xffEntryCount('203.0.113.7,198.51.100.2,192.0.2.9')).toBe(3)
  })

  it('reports no hops when nothing forwarded the request', () => {
    expect(xffEntryCount(undefined)).toBe(0)
    expect(xffEntryCount('')).toBe(0)
  })

  // A trailing comma or padding must not invent a hop that is not there —
  // an off-by-one here is an off-by-one in the setting it is used to choose.
  it('does not count empty entries', () => {
    expect(xffEntryCount('203.0.113.7,')).toBe(1)
    expect(xffEntryCount(' 203.0.113.7 , 198.51.100.2 ')).toBe(2)
    expect(xffEntryCount('  ')).toBe(0)
  })
})
