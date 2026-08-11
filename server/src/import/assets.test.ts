/**
 * Unit tests for bringing a presentation's pictures with it (TMPL-8).
 *
 * The behaviour that matters is what happens when a picture will NOT come:
 * one unreachable image must cost the author that box and nothing more.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAsset, fetchAssets, MAX_ASSET_BYTES } from './assets'

const put = vi.fn()
vi.mock('../storage', () => ({
  getStorage: () => ({
    put,
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  }),
}))

/** A fetch response, shaped the way the reader consumes one. */
const response = (
  over: {
    ok?: boolean
    contentType?: string
    length?: number
    body?: Buffer
  } = {},
) =>
  ({
    ok: over.ok ?? true,
    headers: {
      get: (name: string) =>
        name === 'content-type'
          ? (over.contentType ?? 'image/png')
          : over.length !== undefined
            ? String(over.length)
            : null,
    },
    arrayBuffer: async () => (over.body ?? Buffer.from([1, 2, 3])).buffer,
  }) as unknown as Response

beforeEach(() => {
  put.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('one picture', () => {
  it('is stored under the template’s own prefix and pointed at', async () => {
    vi.mocked(fetch).mockResolvedValue(response())
    const stored = await fetchAsset('https://x/y.png', 'templates/t1', 0)
    expect(stored).toEqual({
      sourceUrl: 'https://x/y.png',
      url: 'https://cdn.test/templates/t1/0.png',
    })
    expect(put).toHaveBeenCalledWith(
      'templates/t1/0.png',
      expect.any(Buffer),
      'image/png',
    )
  })

  it('takes its extension from what was actually served', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ contentType: 'image/jpeg' }))
    const stored = await fetchAsset('https://x/y', 'p', 3)
    expect(stored?.url).toBe('https://cdn.test/p/3.jpg')
  })

  it('is skipped when the host answers with something that is not a picture', async () => {
    // A host answering a picture request with an HTML error page is the common
    // case, and storing it would give the author a box that looks filled
    vi.mocked(fetch).mockResolvedValue(response({ contentType: 'text/html' }))
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it('is skipped when the fetch fails outright', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ok: false }))
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
  })

  it('is skipped when the network throws rather than answering', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
  })

  it('is skipped when it is larger than the ceiling', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ length: MAX_ASSET_BYTES + 1 }),
    )
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
  })

  it('measures the body rather than trusting the declared length', async () => {
    // `content-length` is a claim; a host under-reporting it must not get a
    // huge object into storage
    vi.mocked(fetch).mockResolvedValue(
      response({ length: 10, body: Buffer.alloc(MAX_ASSET_BYTES + 1) }),
    )
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
  })

  it('is skipped when the body is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ body: Buffer.alloc(0) }))
    expect(await fetchAsset('https://x/y.png', 'p', 0)).toBeNull()
  })
})

describe('every picture in a presentation', () => {
  it('fetches each distinct one once, however many slides show it', async () => {
    // A logo on every slide is one file
    vi.mocked(fetch).mockResolvedValue(response())
    const { stored } = await fetchAssets(
      ['https://x/logo.png', 'https://x/logo.png', 'https://x/other.png'],
      'p',
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(stored.size).toBe(2)
  })

  it('counts the ones that would not come, and keeps the rest', async () => {
    // One unreachable image must not cost the author the whole import
    vi.mocked(fetch)
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ ok: false }))
    const { stored, failed } = await fetchAssets(
      ['https://x/a.png', 'https://x/b.png'],
      'p',
    )
    expect(stored.size).toBe(1)
    expect(failed).toBe(1)
  })

  it('ignores blanks rather than counting them as failures', async () => {
    const { stored, failed } = await fetchAssets(['', ''], 'p')
    expect(stored.size).toBe(0)
    expect(failed).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not open a socket per slide on a picture-heavy deck', async () => {
    let open = 0
    let peak = 0
    vi.mocked(fetch).mockImplementation(async () => {
      peak = Math.max(peak, ++open)
      await new Promise(r => setTimeout(r, 1))
      open--
      return response()
    })
    await fetchAssets(
      Array.from({ length: 20 }, (_, i) => `https://x/${i}.png`),
      'p',
      4,
    )
    expect(peak).toBeLessThanOrEqual(4)
  })
})
