import { describe, expect, it } from 'vitest'
import { segmentPhrases } from './phrase-segment'

describe('segmentPhrases', () => {
  it('splits at sentence terminators with exact spans', () => {
    const text = 'One two. Three four? Five!'
    const phrases = segmentPhrases(text)
    expect(phrases.map(p => p.text)).toEqual([
      'One two.',
      'Three four?',
      'Five!',
    ])
    // Spans index the original string exactly.
    for (const p of phrases) {
      expect(text.slice(p.start, p.end)).toBe(p.text)
    }
  })

  it('treats terminator-free text as one phrase', () => {
    expect(segmentPhrases('no terminator here')).toEqual([
      { text: 'no terminator here', start: 0, end: 18 },
    ])
  })

  it('skips empty/whitespace runs and trims', () => {
    const phrases = segmentPhrases('  A.   B.  ')
    expect(phrases.map(p => p.text)).toEqual(['A.', 'B.'])
    expect(phrases[0]!.start).toBe(2)
  })

  it('returns nothing for empty input', () => {
    expect(segmentPhrases('')).toEqual([])
    expect(segmentPhrases('   ')).toEqual([])
  })
})
