/**
 * Unit tests for the editor's placeholder pictures. Two properties carry the
 * feature and both are checked here: the search is cached, so clicking
 * between layout tabs costs nothing, and it is unmetered, so browsing your own
 * template never spends an image lookup. The source adapters are mocked, so
 * the test is offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { previewImageUrls, resetPreviewImageCache } from './preview-images'
import { searchWikimedia } from './wikimedia'
import { searchOpenverse } from './openverse'
import { searchFlickr } from './flickr'
import { runWithUsage } from '../billing/usage-context'
import { recordUsage } from '../billing/usage'
import type { ImageCandidate } from './types'

vi.mock('./wikimedia')
vi.mock('./openverse')
vi.mock('./flickr')
vi.mock('../billing/usage')

const candidate = (url: string): ImageCandidate => ({
  url,
  title: 'A lecture hall',
  tags: ['lecture'],
  source: 'wikimedia',
  width: 1200,
})

beforeEach(() => {
  vi.mocked(searchOpenverse).mockResolvedValue([])
  vi.mocked(searchFlickr).mockResolvedValue([])
  vi.mocked(searchWikimedia).mockResolvedValue([
    candidate('http://img/a.jpg'),
    candidate('http://img/b.jpg'),
  ])
  vi.mocked(recordUsage).mockResolvedValue(undefined as never)
  resetPreviewImageCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('preview images', () => {
  it('finds pictures to fill a preview with', async () => {
    expect(await previewImageUrls(undefined, 2)).toEqual([
      'http://img/a.jpg',
      'http://img/b.jpg',
    ])
  })

  it('returns only as many as asked for', async () => {
    expect(await previewImageUrls(undefined, 1)).toHaveLength(1)
  })

  it('searches once, however many times it is asked', async () => {
    // Clicking between layout tabs must not make a request each time. The
    // default set covers several subjects, so one round is several calls —
    // what matters is that a second ask adds none.
    await previewImageUrls()
    const afterFirst = vi.mocked(searchWikimedia).mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)
    await previewImageUrls()
    await previewImageUrls(undefined, 2)
    expect(searchWikimedia).toHaveBeenCalledTimes(afterFirst)
  })

  it('shares one search between callers that arrive together', async () => {
    await previewImageUrls()
    const afterFirst = vi.mocked(searchWikimedia).mock.calls.length
    resetPreviewImageCache()
    vi.mocked(searchWikimedia).mockClear()
    await Promise.all([
      previewImageUrls(),
      previewImageUrls(),
      previewImageUrls(),
    ])
    // Three callers, one round between them.
    expect(searchWikimedia).toHaveBeenCalledTimes(afterFirst)
  })

  it('keeps separate answers for separate queries', async () => {
    await previewImageUrls('microscope')
    await previewImageUrls('bridge')
    expect(searchWikimedia).toHaveBeenCalledTimes(2)
  })

  it('treats a query as the same however it was typed', async () => {
    await previewImageUrls('Microscope')
    await previewImageUrls('  microscope ')
    expect(searchWikimedia).toHaveBeenCalledTimes(1)
  })

  it('never spends an image lookup on a preview', async () => {
    // The search meters itself, correctly — it cannot know who asked. Running
    // it unattributed is what keeps an author's allowance out of it.
    await runWithUsage('user-1', async () => {
      await previewImageUrls()
    })
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('gives back nothing rather than failing when every source is down', async () => {
    vi.mocked(searchWikimedia).mockRejectedValue(new Error('offline'))
    expect(await previewImageUrls()).toEqual([])
  })

  it('does not retry a failed search on every click', async () => {
    vi.mocked(searchWikimedia).mockRejectedValue(new Error('offline'))
    await previewImageUrls()
    const afterFirst = vi.mocked(searchWikimedia).mock.calls.length
    await previewImageUrls()
    expect(searchWikimedia).toHaveBeenCalledTimes(afterFirst)
  })

  it('tries again once a failure has had time to clear', async () => {
    vi.useFakeTimers()
    vi.mocked(searchWikimedia).mockRejectedValue(new Error('offline'))
    await previewImageUrls()
    // A miss is remembered briefly, so an outage costs one attempt every few
    // minutes rather than one per click.
    vi.advanceTimersByTime(6 * 60 * 1000)
    vi.mocked(searchWikimedia).mockResolvedValue([
      candidate('http://img/c.jpg'),
    ])
    expect(await previewImageUrls()).toEqual(['http://img/c.jpg'])
  })

  /**
   * A preview picture has one job: to show where the pictures go. A layout
   * filled with the same photograph does the opposite — the boxes stop
   * reading as separate boxes, which is the thing the preview exists to
   * show.
   */
  describe('what fills a layout with several picture boxes', () => {
    it('looks in several places, not one', async () => {
      await previewImageUrls()
      const asked = vi
        .mocked(searchWikimedia)
        .mock.calls.map(c => JSON.stringify(c[0]))
      expect(new Set(asked).size).toBeGreaterThan(1)
    })

    it('never offers the same picture twice', async () => {
      // Two subjects can land on the same file. Shown twice in one layout it
      // reads as a mistake the author made.
      vi.mocked(searchWikimedia).mockResolvedValue([
        candidate('http://img/same.jpg'),
        candidate('http://img/other.jpg'),
      ])
      resetPreviewImageCache()
      const urls = await previewImageUrls(undefined, 12)
      expect(new Set(urls).size).toBe(urls.length)
    })

    it('offers enough for a collage, not four', async () => {
      // Each subject finds its own pictures, as a real search does — one
      // mock answer for every subject would dedupe down to a handful.
      vi.mocked(searchWikimedia).mockImplementation(async keywords =>
        Array.from({ length: 3 }, (_, i) =>
          candidate(`http://img/${keywords[0]}-${i}.jpg`),
        ),
      )
      resetPreviewImageCache()
      expect((await previewImageUrls(undefined, 12)).length).toBeGreaterThan(4)
    })

    it('puts a different subject in each consecutive box', async () => {
      // Two frames of the same leaf are two URLs and one picture to the eye.
      // Taking the subjects in turn keeps them apart.
      vi.mocked(searchWikimedia).mockImplementation(async keywords =>
        Array.from({ length: 3 }, (_, i) =>
          candidate(`http://img/${keywords[0]}-${i}.jpg`),
        ),
      )
      resetPreviewImageCache()
      const urls = await previewImageUrls(undefined, 4)
      const subjects = urls.map(u => u.split('/').pop()!.split('-')[0])
      expect(new Set(subjects).size).toBe(subjects.length)
    })
  })

  it('keeps a found set for hours', async () => {
    vi.useFakeTimers()
    await previewImageUrls()
    const afterFirst = vi.mocked(searchWikimedia).mock.calls.length
    vi.advanceTimersByTime(60 * 60 * 1000)
    await previewImageUrls()
    expect(searchWikimedia).toHaveBeenCalledTimes(afterFirst)
  })
})
