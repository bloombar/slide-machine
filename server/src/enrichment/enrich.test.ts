/**
 * Unit tests for the enrichment orchestrator with a stubbed fetch: the
 * pooled parallel query, winner selection, and total fault tolerance.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { enrichImage } from './enrich'

const wikimediaBody = {
  query: {
    pages: {
      '1': {
        title: 'File:Photosynthesis diagram.png',
        imageinfo: [
          {
            thumburl: 'http://wiki/photo.png',
            thumbwidth: 1024,
            height: 768,
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              Artist: { value: '<a href="#">Jane Doe</a>' },
            },
          },
        ],
      },
    },
  },
}

const stubFetch = (handler: (url: string) => Promise<Response> | Response) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  )
}

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('enrichImage', () => {
  it('pools sources and returns the winner with attribution', async () => {
    stubFetch(url => {
      if (url.includes('wikimedia')) return jsonResponse(wikimediaBody)
      if (url.includes('openverse')) return jsonResponse({ results: [] })
      throw new Error('unexpected fetch')
    })

    const result = await enrichImage(['photosynthesis', 'diagram'])
    expect(result).toMatchObject({
      url: 'http://wiki/photo.png',
      source: 'wikimedia',
      attribution: 'Jane Doe (Wikimedia Commons)',
    })
  })

  it('survives a source failing entirely (IMG-2)', async () => {
    stubFetch(url => {
      if (url.includes('wikimedia')) throw new Error('network down')
      if (url.includes('openverse'))
        return jsonResponse({
          results: [
            {
              thumbnail: 'http://ov/photo.jpg',
              title: 'Photosynthesis illustration',
              tags: [{ name: 'diagram' }],
              width: 900,
              attribution: 'Someone (CC BY)',
            },
          ],
        })
      throw new Error('unexpected fetch')
    })

    const result = await enrichImage(['photosynthesis', 'diagram'])
    expect(result?.source).toBe('openverse')
  })

  it('returns null when every source fails or nothing is relevant', async () => {
    stubFetch(() => {
      throw new Error('everything is down')
    })
    expect(await enrichImage(['photosynthesis'])).toBeNull()

    stubFetch(() => jsonResponse({ results: [] }))
    expect(await enrichImage(['photosynthesis'])).toBeNull()
  })

  it('returns null for empty keywords without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await enrichImage([])).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
