/**
 * Unit tests for multi-candidate image search (EDIT-1): it pools all
 * sources, ranks by keyword relevance, drops projector-unfriendly
 * thumbnails, de-duplicates by URL, caps the count, and never throws when
 * a source fails. The source adapters are mocked so the test is offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchImageCandidates } from './search'
import { searchWikimedia } from './wikimedia'
import { searchOpenverse } from './openverse'
import { searchFlickr } from './flickr'
import type { ImageCandidate } from './types'

vi.mock('./wikimedia')
vi.mock('./openverse')
vi.mock('./flickr')

const candidate = (over: Partial<ImageCandidate>): ImageCandidate => ({
  url: 'http://img/x.png',
  title: '',
  tags: [],
  source: 'wikimedia',
  width: 800,
  ...over,
})

beforeEach(() => {
  vi.mocked(searchWikimedia).mockResolvedValue([])
  vi.mocked(searchOpenverse).mockResolvedValue([])
  vi.mocked(searchFlickr).mockResolvedValue([])
})

describe('searchImageCandidates', () => {
  it('returns nothing for empty keywords without querying', async () => {
    expect(await searchImageCandidates([])).toEqual([])
    expect(searchWikimedia).not.toHaveBeenCalled()
  })

  it('pools every source and ranks the most relevant first', async () => {
    vi.mocked(searchFlickr).mockResolvedValue([
      candidate({
        url: 'f1',
        title: 'a blurry unrelated photo',
        source: 'flickr',
      }),
    ])
    vi.mocked(searchWikimedia).mockResolvedValue([
      candidate({
        url: 'w1',
        title: 'mitochondria diagram',
        source: 'wikimedia',
      }),
    ])

    const results = await searchImageCandidates(['mitochondria'])
    expect(results.map(r => r.url)).toEqual(['w1', 'f1'])
  })

  it('drops thumbnails too small for a projector', async () => {
    vi.mocked(searchWikimedia).mockResolvedValue([
      candidate({ url: 'tiny', title: 'cell', width: 100 }),
      candidate({ url: 'big', title: 'cell', width: 800 }),
    ])
    const results = await searchImageCandidates(['cell'])
    expect(results.map(r => r.url)).toEqual(['big'])
  })

  it('de-duplicates the same URL surfaced by two sources', async () => {
    vi.mocked(searchWikimedia).mockResolvedValue([
      candidate({ url: 'same', title: 'cell', source: 'wikimedia' }),
    ])
    vi.mocked(searchOpenverse).mockResolvedValue([
      candidate({ url: 'same', title: 'cell', source: 'openverse' }),
    ])
    const results = await searchImageCandidates(['cell'])
    expect(results).toHaveLength(1)
  })

  it('caps the number of results at the requested limit', async () => {
    vi.mocked(searchWikimedia).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        candidate({ url: `w${i}`, title: 'cell' }),
      ),
    )
    const results = await searchImageCandidates(['cell'], 5)
    expect(results).toHaveLength(5)
  })

  it('still returns results when a source fails', async () => {
    vi.mocked(searchFlickr).mockRejectedValue(new Error('flickr down'))
    vi.mocked(searchWikimedia).mockResolvedValue([
      candidate({ url: 'w1', title: 'cell' }),
    ])
    const results = await searchImageCandidates(['cell'])
    expect(results.map(r => r.url)).toEqual(['w1'])
  })
})
