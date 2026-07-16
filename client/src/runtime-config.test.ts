/**
 * Unit tests for the boot-time runtime config: it fetches /api/config once,
 * caches the speech engine, and falls back to the keyless browser engine on
 * failure. The module caches across calls, so each test re-imports it fresh.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('runtime config', () => {
  it('defaults to the browser engine before load', async () => {
    const { getSttEngine } = await import('./runtime-config')
    expect(getSttEngine()).toBe('browser')
  })

  it('loads and caches the server-reported engine', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sttEngine: 'google-cloud' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { loadRuntimeConfig, getSttEngine } = await import('./runtime-config')

    expect(await loadRuntimeConfig()).toEqual({ sttEngine: 'google-cloud' })
    expect(getSttEngine()).toBe('google-cloud')
    // Cached: a second call does not fetch again.
    await loadRuntimeConfig()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to browser when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    const { loadRuntimeConfig, getSttEngine } = await import('./runtime-config')
    await loadRuntimeConfig()
    expect(getSttEngine()).toBe('browser')
  })

  it('falls back to browser on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      ),
    )
    const { loadRuntimeConfig, getSttEngine } = await import('./runtime-config')
    await loadRuntimeConfig()
    expect(getSttEngine()).toBe('browser')
  })
})
