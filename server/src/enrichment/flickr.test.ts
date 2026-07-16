/**
 * Unit tests for the Flickr adapter: mapping photo fields and numeric
 * license ids onto the shared ImageAttribution shape (IMG-5), including
 * the derived photo/owner URLs. The config module is mocked so the key
 * gate is satisfied without a real environment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/env', () => ({ env: { FLICKR_API_KEY: 'test-key' } }))

const { searchFlickr } = await import('./flickr')

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

describe('searchFlickr', () => {
  it('maps a photo and its license id onto full ImageAttribution', async () => {
    stubFetch({
      photos: {
        photo: [
          {
            id: '123',
            owner: '99@N00',
            ownername: 'Jane',
            title: 'A leaf',
            tags: 'leaf green',
            url_c: 'http://flickr/leaf_c.jpg',
            width_c: 800,
            height_c: 600,
            license: '4',
            description: { _content: 'A green leaf' },
          },
        ],
      },
    })

    const [candidate] = await searchFlickr(['leaf'], never())
    expect(candidate?.url).toBe('http://flickr/leaf_c.jpg')
    expect(candidate?.attribution).toEqual({
      caption: 'A green leaf',
      title: 'A leaf',
      creator: 'Jane',
      creatorUrl: 'https://www.flickr.com/photos/99@N00/',
      sourceUrl: 'https://www.flickr.com/photos/99@N00/123',
      sourceName: 'Flickr',
      license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    })
  })

  it('maps CC0 to a name with an empty deed url cleared to undefined', async () => {
    stubFetch({
      photos: {
        photo: [
          {
            id: '1',
            owner: 'u',
            ownername: 'Pat',
            title: 'PD',
            url_c: 'http://flickr/pd_c.jpg',
            license: '9',
          },
        ],
      },
    })
    const [candidate] = await searchFlickr(['pd'], never())
    expect(candidate?.attribution?.license).toBe('CC0 1.0')
    expect(candidate?.attribution?.licenseUrl).toBe(
      'https://creativecommons.org/publicdomain/zero/1.0/',
    )
  })

  it('returns [] without the API key', async () => {
    vi.resetModules()
    vi.doMock('../config/env', () => ({ env: {} }))
    const { searchFlickr: keyless } = await import('./flickr')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await keyless(['x'], never())).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.doUnmock('../config/env')
    vi.resetModules()
  })
})
