/**
 * Unit tests for candidate scoring: relevance ranking, source priors,
 * threshold rejection, and the minimum-size filter.
 */
import { describe, it, expect } from 'vitest'
import { pickBest, scoreCandidate } from './scoring'
import type { ImageCandidate } from './types'

const candidate = (overrides: Partial<ImageCandidate>): ImageCandidate => ({
  url: 'http://img/x.jpg',
  title: '',
  tags: [],
  source: 'wikimedia',
  width: 800,
  ...overrides,
})

describe('scoreCandidate', () => {
  it('scores by keyword overlap in title and tags', () => {
    const kw = ['photosynthesis', 'chlorophyll']
    const both = candidate({
      title: 'Photosynthesis diagram',
      tags: ['chlorophyll'],
    })
    const one = candidate({ title: 'Photosynthesis in plants' })
    const none = candidate({ title: 'A cat on a sofa' })

    expect(scoreCandidate(both, kw)).toBeGreaterThan(scoreCandidate(one, kw))
    expect(scoreCandidate(one, kw)).toBeGreaterThan(scoreCandidate(none, kw))
    expect(scoreCandidate(none, kw)).toBe(0)
  })

  it('prefers higher-trust sources at equal relevance', () => {
    const kw = ['photosynthesis']
    const wiki = candidate({
      title: 'Photosynthesis',
      source: 'wikimedia',
      width: 500,
    })
    const flickr = candidate({
      title: 'Photosynthesis',
      source: 'flickr',
      width: 500,
    })
    expect(scoreCandidate(wiki, kw)).toBeGreaterThan(scoreCandidate(flickr, kw))
  })
})

describe('pickBest', () => {
  it('returns the top candidate above the threshold', () => {
    const kw = ['photosynthesis']
    const best = pickBest(
      [
        candidate({ title: 'Unrelated landscape' }),
        candidate({
          title: 'Photosynthesis overview',
          url: 'http://img/win.jpg',
        }),
      ],
      kw,
    )
    expect(best?.url).toBe('http://img/win.jpg')
  })

  it('returns null when nothing is relevant enough (graceful fallback)', () => {
    expect(
      pickBest([candidate({ title: 'A cat' })], ['photosynthesis']),
    ).toBeNull()
  })

  it('skips tiny images', () => {
    const kw = ['photosynthesis']
    const tiny = candidate({
      title: 'Photosynthesis',
      width: 100,
      url: 'http://img/tiny.jpg',
    })
    expect(pickBest([tiny], kw)).toBeNull()
  })

  it('returns null for an empty pool', () => {
    expect(pickBest([], ['anything'])).toBeNull()
  })
})

describe('seeded source prior (SEED-2)', () => {
  it("prefers the instructor's own image over an equal web match", () => {
    const keywords = ['mitochondria']
    const seeded = candidate({
      url: 'http://files/own.jpg',
      title: 'mitochondria diagram',
      source: 'seeded',
      width: undefined,
    })
    const web = candidate({
      url: 'http://img/web.jpg',
      title: 'mitochondria diagram',
      source: 'wikimedia',
      width: 1200,
    })
    expect(pickBest([web, seeded], keywords)?.url).toBe('http://files/own.jpg')
  })

  it('still rejects irrelevant seeded images', () => {
    const seeded = candidate({
      title: 'holiday photo',
      tags: ['beach'],
      source: 'seeded',
    })
    expect(pickBest([seeded], ['mitochondria'])).toBeNull()
  })
})
