/**
 * Unit tests for slide keyword derivation: the title is preferred, then
 * bullets, then body, then the caption; stopwords and short tokens are
 * dropped, terms are deduped and capped, and a textless slide yields nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveImageKeywords,
  tightenSearchPhrase,
  tightenSearchPhrases,
} from './keywords'

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

/**
 * Cutting a search phrase down to what actually finds a picture (IMG-1).
 *
 * Measured against the real sources, the phrases the model writes unprompted
 * returned nothing at all: "burette conical flask titration laboratory setup"
 * and two others came back with zero usable candidates, because every source
 * matches all the words. The same phrases cut to two significant words return
 * a pool. These assert the cut, not the search.
 */
describe('tightenSearchPhrase', () => {
  it('keeps the subject and drops the tail that matched nothing', () => {
    expect(
      tightenSearchPhrase('mitochondrion cristae electron transport chain'),
    ).toBe('mitochondrion cristae')
    expect(
      tightenSearchPhrase('burette conical flask titration laboratory setup'),
    ).toBe('burette conical')
  })

  it('spends its words on the nouns, not the stopwords', () => {
    // "the structure" would be one real word and one that matches everything
    expect(tightenSearchPhrase('the structure of a chloroplast')).toBe(
      'structure chloroplast',
    )
  })

  it('keeps a phrase that is already short', () => {
    expect(tightenSearchPhrase('parthenon')).toBe('parthenon')
    expect(tightenSearchPhrase('burette titration')).toBe('burette titration')
  })

  it('falls back to the raw words when every word is a stopword', () => {
    // A poor query still beats no query: returning '' would drop the phrase
    expect(tightenSearchPhrase('the and of')).toBe('the and')
  })

  it('is empty only for empty input', () => {
    expect(tightenSearchPhrase('   ')).toBe('')
    expect(tightenSearchPhrase('')).toBe('')
  })

  it('honours a caller-supplied word count', () => {
    expect(tightenSearchPhrase('mitochondrion cristae electron', 1)).toBe(
      'mitochondrion',
    )
    expect(tightenSearchPhrase('mitochondrion cristae electron', 3)).toBe(
      'mitochondrion cristae electron',
    )
  })
})

describe('tightenSearchPhrases', () => {
  it('drops a duplicate the cut created', () => {
    // Both describe the same picture once their tails are gone; searching the
    // identical query twice spends a source request for nothing
    expect(
      tightenSearchPhrases([
        'chloroplast thylakoid membrane',
        'chloroplast thylakoid stack',
      ]),
    ).toEqual(['chloroplast thylakoid'])
  })

  it('ignores case when deduping, and drops blanks', () => {
    expect(
      tightenSearchPhrases([
        'Parthenon Acropolis',
        'parthenon acropolis',
        '  ',
      ]),
    ).toEqual(['Parthenon Acropolis'])
  })

  it('keeps genuinely different phrases, in order', () => {
    expect(
      tightenSearchPhrases([
        'mitochondrion cristae electron chain',
        'cell biology diagram illustration',
      ]),
    ).toEqual(['mitochondrion cristae', 'cell biology'])
  })

  it('returns nothing for nothing', () => {
    expect(tightenSearchPhrases([])).toEqual([])
  })
})

describe('the word cap failing safe', () => {
  it('cuts to the default when the environment states no cap', () => {
    // `slice(0, undefined)` keeps everything, so an unset value would have
    // made this a no-op that still looked like it ran — and the only symptom
    // would have been an empty picture box, far from here
    expect(
      tightenSearchPhrase(
        'mitochondrion cristae electron transport',
        undefined,
      ),
    ).toBe('mitochondrion cristae')
  })

  it('cuts to the default when handed a nonsense cap', () => {
    expect(tightenSearchPhrase('alpha beta gamma delta', 0)).toBe('alpha beta')
    expect(tightenSearchPhrase('alpha beta gamma delta', -3)).toBe('alpha beta')
  })
})
