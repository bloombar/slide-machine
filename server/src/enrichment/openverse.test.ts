/**
 * Unit tests for the Openverse adapter: reporting dimensions that match
 * the attached thumbnail (the proxy caps width at 600px), and mapping the
 * structured license/credit fields onto ImageAttribution (IMG-5).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { searchOpenverse } from './openverse'

const stubFetch = (body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  )
}

const never = (): AbortSignal => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchOpenverse', () => {
  it('clamps a large original to the 600px thumbnail it serves', async () => {
    stubFetch({
      results: [
        {
          thumbnail: 'http://ov/thumb.jpg',
          title: 'Wide photo',
          width: 4000,
          height: 3000,
        },
      ],
    })
    const [candidate] = await searchOpenverse(['photo'], never())
    expect(candidate?.url).toBe('http://ov/thumb.jpg')
    // 3000 * 600 / 4000 = 450, preserving aspect ratio
    expect(candidate?.width).toBe(600)
    expect(candidate?.height).toBe(450)
  })

  it('leaves an original smaller than the thumbnail cap untouched', async () => {
    stubFetch({
      results: [
        {
          thumbnail: 'http://ov/small.jpg',
          title: 'Small',
          width: 480,
          height: 320,
        },
      ],
    })
    const [candidate] = await searchOpenverse(['small'], never())
    expect(candidate?.width).toBe(480)
    expect(candidate?.height).toBe(320)
  })

  it('reports the full size when falling back to the original url', async () => {
    stubFetch({
      results: [
        { url: 'http://ov/full.jpg', title: 'Full', width: 4000, height: 3000 },
      ],
    })
    const [candidate] = await searchOpenverse(['full'], never())
    expect(candidate?.url).toBe('http://ov/full.jpg')
    expect(candidate?.width).toBe(4000)
    expect(candidate?.height).toBe(3000)
  })

  it('maps license code + version and credit onto ImageAttribution', async () => {
    stubFetch({
      results: [
        {
          thumbnail: 'http://ov/thumb.jpg',
          title: 'Chlorophyll',
          creator: 'A. Botanist',
          creator_url: 'http://ex/botanist',
          foreign_landing_url: 'http://ex/photo/1',
          license: 'by-sa',
          license_version: '4.0',
          license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
          width: 800,
        },
      ],
    })
    const [candidate] = await searchOpenverse(['chlorophyll'], never())
    expect(candidate?.attribution).toEqual({
      title: 'Chlorophyll',
      creator: 'A. Botanist',
      creatorUrl: 'http://ex/botanist',
      sourceUrl: 'http://ex/photo/1',
      sourceName: 'Openverse',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    })
  })

  it('labels public-domain marks without a CC prefix', async () => {
    stubFetch({
      results: [
        {
          thumbnail: 'http://ov/a.jpg',
          title: 'A',
          license: 'cc0',
          license_version: '1.0',
        },
        { thumbnail: 'http://ov/b.jpg', title: 'B', license: 'pdm' },
      ],
    })
    const results = await searchOpenverse(['x'], never())
    expect(results[0]?.attribution?.license).toBe('CC0 1.0')
    expect(results[1]?.attribution?.license).toBe('Public Domain Mark')
  })

  it('returns [] on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    expect(await searchOpenverse(['x'], never())).toEqual([])
  })
})
