/**
 * Unit tests for slide keyword derivation: the title is preferred, then
 * bullets, then body, then the caption; stopwords and short tokens are
 * dropped, terms are deduped and capped, and a textless slide yields nothing.
 */
import { describe, it, expect } from 'vitest'
import { deriveImageKeywords } from './keywords'

describe('deriveImageKeywords', () => {
  it('mines salient words from the title, dropping stopwords', () => {
    expect(
      deriveImageKeywords({ title: 'The Mitochondria of the Cell' }),
    ).toEqual(['mitochondria', 'cell'])
  })

  it('prefers the title over bullets and body', () => {
    expect(
      deriveImageKeywords({
        title: 'Photosynthesis',
        bullets: ['chloroplast reactions'],
        body: 'plants make sugar',
      }),
    ).toEqual(['photosynthesis'])
  })

  it('falls back to bullets when there is no title', () => {
    expect(deriveImageKeywords({ bullets: ['Newton laws', 'motion'] })).toEqual(
      ['newton', 'laws', 'motion'],
    )
  })

  it('falls back to the body when there is no title or bullets', () => {
    expect(deriveImageKeywords({ body: 'volcanic eruption basics' })).toEqual([
      'volcanic',
      'eruption',
      'basics',
    ])
  })

  /**
   * The picture-led layout, `image-heavy`, declares an image slot and a
   * caption and nothing else — so a slide on it has no title, bullets or body
   * to mine. Without this tier every such slide searches for nothing and its
   * picture box stays empty for good.
   */
  it('falls back to the caption when the slide has no other text', () => {
    expect(
      deriveImageKeywords({ caption: 'Waterfall lifecycle diagram' }),
    ).toEqual(['waterfall', 'lifecycle', 'diagram'])
  })

  it('prefers a title over a caption', () => {
    expect(
      deriveImageKeywords({ title: 'Photosynthesis', caption: 'A green leaf' }),
    ).toEqual(['photosynthesis'])
  })

  it('dedupes repeated words and drops short tokens', () => {
    expect(deriveImageKeywords({ title: 'DNA and dna in a helix' })).toEqual([
      'dna',
      'helix',
    ])
  })

  it('caps the number of keywords', () => {
    expect(
      deriveImageKeywords({
        title: 'alpha beta gamma delta epsilon zeta eta theta',
      }),
    ).toHaveLength(6)
  })

  it('returns nothing for a textless slide', () => {
    expect(deriveImageKeywords({})).toEqual([])
    expect(
      deriveImageKeywords({ title: '   ', bullets: [], body: '' }),
    ).toEqual([])
  })
})
