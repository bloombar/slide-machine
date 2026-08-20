/**
 * Unit tests for the shared slide-image fetcher: format detection by magic
 * bytes (not the unreliable Content-Type), WebP→PNG conversion, retry on
 * rate-limit (429) and HTML block pages, and best-effort skipping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSlideImages, toDataUri } from './deck-image'
import { getStorage } from '../storage'

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

/**
 * A picture the app stores itself (EXP-1/TMPL-8).
 *
 * The local storage driver hands out an app-relative URL — `/api/files/<key>`
 * — because that is what a browser needs. `fetch` cannot use one: it wants an
 * absolute URL, and the export runs on the server with no origin to resolve
 * against. So the fetcher refused every one of them and returned nothing, and
 * an imported deck — where EVERY picture is one of these, fetched from Google
 * once and kept — exported with a hole wherever an image had been.
 */
describe('a picture the app stores itself', () => {
  /** A real one-pixel PNG, put where the app would have put it. */
  const stored = async (key: string) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    await getStorage().put(key, png, 'image/png')
    return getStorage().publicUrl(key)
  }

  it('is read off storage rather than fetched', async () => {
    // No fetch stub: reaching the network at all would be the bug.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('the export must not fetch a picture it already holds')
      }),
    )
    const url = await stored('probe/deck-image/one.png')
    const [image] = await fetchSlideImages([url])
    expect(image?.kind).toBe('png')
    expect(image!.data.length).toBeGreaterThan(0)
  })

  it('comes back missing, not fatal, when the file is gone', async () => {
    const [image] = await fetchSlideImages([
      '/api/files/probe/deck-image/nope.png',
    ])
    expect(image).toBeUndefined()
  })

  it('still refuses a URL that is neither ours nor absolute', async () => {
    // A relative path we do not serve is not something to go looking for.
    expect((await fetchSlideImages(['images/leaf.png']))[0]).toBeUndefined()
  })
})
