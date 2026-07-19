/**
 * Unit tests for the enrichment orchestrator with a stubbed fetch: the
 * pooled parallel query, winner selection, and total fault tolerance.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
// Control the AI re-rank directly; the network side is covered in ai-rank.test.
vi.mock('./ai-rank', () => ({ rankAndCaption: vi.fn() }))
import { enrichImage } from './enrich'
import { rankAndCaption } from './ai-rank'
import type { SlideImageContext } from './types'

const mockedRank = vi.mocked(rankAndCaption)

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
  mockedRank.mockReset()
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
      attribution: {
        title: 'Photosynthesis diagram',
        creator: 'Jane Doe',
        license: 'CC BY-SA 4.0',
        sourceName: 'Wikimedia Commons',
      },
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

describe('enrichImage AI re-rank', () => {
  const ctx: SlideImageContext = {
    layoutType: 'image-heavy',
    captionMode: 'replace',
  }
  const onlyWikimedia = () =>
    stubFetch(url => {
      if (url.includes('wikimedia')) return jsonResponse(wikimediaBody)
      return jsonResponse({ results: [] })
    })

  it('uses the AI-chosen candidate and its caption when context is given', async () => {
    onlyWikimedia()
    mockedRank.mockResolvedValue({ index: 0, caption: 'A matched caption' })
    const res = await enrichImage(['photosynthesis', 'diagram'], [], ctx)
    expect(res?.url).toBe('http://wiki/photo.png')
    expect(res?.caption).toBe('A matched caption')
    expect(mockedRank).toHaveBeenCalledOnce()
  })

  it('falls back to heuristic scoring (no caption) when the AI declines', async () => {
    onlyWikimedia()
    mockedRank.mockResolvedValue(null)
    const res = await enrichImage(['photosynthesis', 'diagram'], [], ctx)
    expect(res?.url).toBe('http://wiki/photo.png')
    expect(res?.caption).toBeUndefined()
  })

  it('never calls the re-rank when no context is supplied', async () => {
    onlyWikimedia()
    const res = await enrichImage(['photosynthesis', 'diagram'])
    expect(res?.url).toBe('http://wiki/photo.png')
    expect(mockedRank).not.toHaveBeenCalled()
  })
})
