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
    // Clicking between layout tabs must not make a request each time.
    await previewImageUrls()
    await previewImageUrls()
    await previewImageUrls(undefined, 2)
    expect(searchWikimedia).toHaveBeenCalledTimes(1)
  })

  it('shares one search between callers that arrive together', async () => {
    await Promise.all([
      previewImageUrls(),
      previewImageUrls(),
      previewImageUrls(),
    ])
    expect(searchWikimedia).toHaveBeenCalledTimes(1)
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
    await previewImageUrls()
    expect(searchWikimedia).toHaveBeenCalledTimes(1)
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

  it('keeps a found set for hours', async () => {
    vi.useFakeTimers()
    await previewImageUrls()
    vi.advanceTimersByTime(60 * 60 * 1000)
    await previewImageUrls()
    expect(searchWikimedia).toHaveBeenCalledTimes(1)
  })
})
