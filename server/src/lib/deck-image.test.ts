/**
 * Unit tests for the shared slide-image fetcher: format detection by magic
 * bytes (not the unreliable Content-Type), WebP→PNG conversion, retry on
 * rate-limit (429) and HTML block pages, and best-effort skipping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSlideImages, toDataUri } from './deck-image'

afterEach(() => vi.unstubAllGlobals())

// Real leading bytes for each format (the fetcher sniffs these, not headers).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
const HTML = new TextEncoder().encode('<!DOCTYPE html><html>rate limited')
const WEBP = Uint8Array.from(
  Buffer.from(
    'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=',
    'base64',
  ),
)

/** A fetch Response stub whose body is `bytes`, with a (deliberately wrong)
 * content-type to prove detection ignores it. */
const resFor = (bytes: Uint8Array, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/octet-stream' },
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
})

describe('fetchSlideImages', () => {
  it('detects PNG/JPEG by bytes and skips absent/invalid URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resFor(PNG))
      .mockResolvedValueOnce(resFor(JPEG))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchSlideImages([
      'https://img/a',
      'https://img/b',
      undefined,
    ])
    expect(out[0]?.kind).toBe('png')
    expect(out[1]?.kind).toBe('jpeg')
    expect(out[2]).toBeUndefined()
    // A descriptive User-Agent is sent (Wikimedia requires it).
    expect(fetchMock.mock.calls[0]![1].headers['User-Agent']).toMatch(
      /SlideMachine/,
    )
  })

  it('converts WebP to PNG (pdf-lib cannot embed WebP)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resFor(WEBP)))
    const out = await fetchSlideImages(['https://img/a.webp'])
    expect(out[0]?.kind).toBe('png')
    // Real PNG magic bytes after conversion.
    expect(Array.from(out[0]!.data.slice(0, 4))).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ])
  })

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValue(resFor(PNG))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchSlideImages(['https://img/a.png'])
    expect(out[0]?.kind).toBe('png')
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('retries a 200-status HTML block page, then gives up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resFor(HTML))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchSlideImages(['https://img/a'])
    expect(out[0]).toBeUndefined()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1) // it retried
  })

  it('gives up (undefined) on a hard error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    )
    expect((await fetchSlideImages(['https://img/a.png']))[0]).toBeUndefined()
  })
})

describe('toDataUri', () => {
  it('builds a base64 data URI of the right mime', () => {
    expect(toDataUri({ data: new Uint8Array([1, 2, 3]), kind: 'png' })).toBe(
      'data:image/png;base64,AQID',
    )
  })
})
