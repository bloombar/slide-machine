/**
 * Unit tests for the shared slide-image fetcher: format detection, best-effort
 * skipping, bounded concurrency, and retry on rate-limit (429) responses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSlideImages, toDataUri } from './deck-image'

afterEach(() => vi.unstubAllGlobals())

const okPng = {
  ok: true,
  status: 200,
  headers: { get: () => 'image/png' },
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
}

describe('fetchSlideImages', () => {
  it('fetches images in order and skips absent/invalid URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okPng))
    const out = await fetchSlideImages([
      'https://img/a.png',
      undefined,
      'not-a-url',
    ])
    expect(out[0]).toEqual({ data: new Uint8Array([1, 2, 3]), kind: 'png' })
    expect(out[1]).toBeUndefined()
    expect(out[2]).toBeUndefined()
  })

  it('sends a User-Agent (image hosts require it) and detects jpeg', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchSlideImages(['https://img/a.jpg'])
    expect(out[0]!.kind).toBe('jpeg')
    expect(fetchMock.mock.calls[0]![1].headers['User-Agent']).toMatch(
      /SlideMachine/,
    )
  })

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValue(okPng)
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchSlideImages(['https://img/a.png'])
    expect(out[0]?.kind).toBe('png')
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('gives up (undefined) on a non-retryable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    )
    expect((await fetchSlideImages(['https://img/a.png']))[0]).toBeUndefined()
  })

  it('unsupported content types are skipped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/webp' },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }),
    )
    expect((await fetchSlideImages(['https://img/a.webp']))[0]).toBeUndefined()
  })
})

describe('toDataUri', () => {
  it('builds a base64 data URI of the right mime', () => {
    expect(toDataUri({ data: new Uint8Array([1, 2, 3]), kind: 'png' })).toBe(
      'data:image/png;base64,AQID',
    )
  })
})
