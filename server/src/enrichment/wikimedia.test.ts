/**
 * Unit tests for the Wikimedia adapter: mapping a File page's imageinfo
 * and extmetadata onto the shared ImageAttribution shape (IMG-5),
 * including HTML stripping and href normalization for the creator link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { searchWikimedia } from './wikimedia'

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

describe('searchWikimedia', () => {
  it('maps imageinfo + extmetadata onto full ImageAttribution', async () => {
    stubFetch({
      query: {
        pages: {
          '1': {
            title: 'File:Chlorophyll structure.svg',
            imageinfo: [
              {
                thumburl: 'http://wiki/c.png',
                descriptionurl:
                  'https://commons.wikimedia.org/wiki/File:Chlorophyll_structure.svg',
                thumbwidth: 1024,
                height: 800,
                extmetadata: {
                  ImageDescription: {
                    value: '<p>Structure of chlorophyll</p>',
                  },
                  LicenseShortName: { value: 'CC BY-SA 4.0' },
                  LicenseUrl: {
                    value: 'https://creativecommons.org/licenses/by-sa/4.0/',
                  },
                  Artist: {
                    value:
                      '<a href="//commons.wikimedia.org/wiki/User:Bob">Bob</a>',
                  },
                  Categories: { value: 'Chlorophyll|Molecules' },
                },
              },
            ],
          },
        },
      },
    })

    const [candidate] = await searchWikimedia(['chlorophyll'], never())
    expect(candidate?.title).toBe('Chlorophyll structure')
    expect(candidate?.tags).toEqual(['Chlorophyll', 'Molecules'])
    expect(candidate?.attribution).toEqual({
      caption: 'Structure of chlorophyll',
      title: 'Chlorophyll structure',
      creator: 'Bob',
      // protocol-relative href is normalized to https
      creatorUrl: 'https://commons.wikimedia.org/wiki/User:Bob',
      sourceUrl:
        'https://commons.wikimedia.org/wiki/File:Chlorophyll_structure.svg',
      sourceName: 'Wikimedia Commons',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    })
  })

  it('omits missing fields rather than guessing them', async () => {
    stubFetch({
      query: {
        pages: {
          '1': {
            title: 'File:Bare.jpg',
            imageinfo: [{ url: 'http://wiki/bare.jpg', width: 900 }],
          },
        },
      },
    })
    const [candidate] = await searchWikimedia(['bare'], never())
    expect(candidate?.attribution).toEqual({
      caption: undefined,
      title: 'Bare',
      creator: undefined,
      creatorUrl: undefined,
      sourceUrl: undefined,
      sourceName: 'Wikimedia Commons',
      license: undefined,
      licenseUrl: undefined,
    })
  })
})
