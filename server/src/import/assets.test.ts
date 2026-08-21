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
    // Sliced to the view: a Node Buffer's `.buffer` is the shared pool it was
    // allocated from, not its own bytes, so handing it back whole would give
    // the reader kilobytes of unrelated memory instead of the picture.
    arrayBuffer: async () => {
      const body = over.body ?? Buffer.from([1, 2, 3])
      return body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      )
    },
  }) as unknown as Response

beforeEach(() => {
  put.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('one picture', () => {
  it('is stored under the template’s own prefix and pointed at', async () => {
    vi.mocked(fetch).mockResolvedValue(response())
    const stored = await fetchAsset('https://x/y.png', 'templates/t1')
    expect(stored?.sourceUrl).toBe('https://x/y.png')
    expect(stored?.url).toMatch(
      /^https:\/\/cdn\.test\/templates\/t1\/[0-9a-f]{32}\.png$/,
    )
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^templates\/t1\/[0-9a-f]{32}\.png$/),
      expect.any(Buffer),
      'image/png',
    )
  })

  it('takes its extension from what was actually served', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ contentType: 'image/jpeg' }))
    const stored = await fetchAsset('https://x/y', 'p')
    expect(stored?.url).toMatch(/^https:\/\/cdn\.test\/p\/[0-9a-f]{32}\.jpg$/)
  })

  it('is skipped when the host answers with something that is not a picture', async () => {
    // A host answering a picture request with an HTML error page is the common
    // case, and storing it would give the author a box that looks filled
    vi.mocked(fetch).mockResolvedValue(response({ contentType: 'text/html' }))
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it('is skipped when the fetch fails outright', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ok: false }))
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
  })

  it('is skipped when the network throws rather than answering', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
  })

  it('is skipped when it is larger than the ceiling', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ length: MAX_ASSET_BYTES + 1 }),
    )
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
  })

  it('measures the body rather than trusting the declared length', async () => {
    // `content-length` is a claim; a host under-reporting it must not get a
    // huge object into storage
    vi.mocked(fetch).mockResolvedValue(
      response({ length: 10, body: Buffer.alloc(MAX_ASSET_BYTES + 1) }),
    )
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
  })

  it('is skipped when the body is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ body: Buffer.alloc(0) }))
    expect(await fetchAsset('https://x/y.png', 'p')).toBeNull()
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

/**
 * Importing the same deck twice (TMPL-8).
 *
 * The prefix is the owner and the presentation, so it is identical on every
 * import of the same deck. Named by POSITION, the second import overwrote
 * `0.png`, `1.png` and the rest — and the order is not stable between runs,
 * because Google's image URLs are short-lived and the order they are met in
 * follows consolidation, which can group a deck differently each time.
 *
 * So every template imported earlier kept pointing at those same paths and
 * silently began showing whatever now sat at that index: a crest replaced by
 * a photograph of a building, and an instructor's design quietly wrong.
 */
describe('a deck imported more than once', () => {
  /** A response serving distinct bytes per URL, as two real pictures would. */
  const serving = (bytes: Record<string, number[]>) =>
    vi
      .mocked(fetch)
      .mockImplementation((async (url: string) =>
        response({ body: Buffer.from(bytes[url] ?? [9, 9, 9]) })) as never)

  it('files a picture by what it is, so the same one lands in one place', async () => {
    serving({ 'https://a/1': [1, 2, 3], 'https://b/2': [1, 2, 3] })
    // Two URLs, one picture: the same bytes must not be stored twice.
    const { stored } = await fetchAssets(['https://a/1', 'https://b/2'], 'p')
    expect(new Set(stored.values()).size).toBe(1)
  })

  it('does not displace a picture a template already points at', async () => {
    // The crest, imported once...
    serving({ 'https://first/crest': [7, 7, 7] })
    const first = await fetchAssets(['https://first/crest'], 'p')
    const crest = first.stored.get('https://first/crest')!

    // ...then the deck is imported again. Google hands back a fresh URL for
    // the same crest and a DIFFERENT picture in the position the crest held.
    serving({
      'https://second/photo': [4, 4, 4],
      'https://second/crest': [7, 7, 7],
    })
    const second = await fetchAssets(
      ['https://second/photo', 'https://second/crest'],
      'p',
    )

    // The crest is still where the first template left it...
    expect(second.stored.get('https://second/crest')).toBe(crest)
    // ...and the photograph did not take its place.
    expect(second.stored.get('https://second/photo')).not.toBe(crest)
  })

  it('rewrites a picture only with its own bytes', async () => {
    serving({ 'https://a/1': [1, 2, 3] })
    await fetchAssets(['https://a/1'], 'p')
    await fetchAssets(['https://a/1'], 'p')
    const keys = put.mock.calls.map(call => call[0])
    // Twice to the same key, and that key holds what it always held.
    expect(new Set(keys).size).toBe(1)
  })
})
