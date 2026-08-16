/**
 * An image's provenance through Google Slides and PowerPoint (IMG-5/EXP-8).
 *
 * Neither format has a field for where a picture came from, so a deck
 * exported, worked on there and imported back returned with anonymous
 * pictures — and a licence requiring attribution silently unsatisfied. Alt
 * text is the field EXP-8 already uses to round-trip what a box IS; this puts
 * the credit beside it.
 */
import { describe, it, expect } from 'vitest'
import { slotToken, slotFromToken } from './slot-metadata'
import {
  creditToken,
  creditFromToken,
  MAX_CREDIT_PAYLOAD,
} from './image-attribution-token'

const tasl = {
  title: 'Mitochondrion',
  creator: 'Ada Lovelace',
  creatorUrl: 'https://example.org/ada',
  sourceName: 'Wikimedia',
  sourceUrl: 'https://commons.wikimedia.org/x',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
}

describe('the credit an exported picture carries', () => {
  it('comes back exactly as it went out', () => {
    expect(creditFromToken(creditToken(tasl))).toEqual(tasl)
  })

  it('is nothing when there is nothing worth carrying', () => {
    expect(creditToken(undefined)).toBeUndefined()
    expect(creditToken({})).toBeUndefined()
    // Present but empty is the same as absent: a credit of blank strings
    // would read as a credit.
    expect(creditToken({ title: '   ', creator: '' })).toBeUndefined()
  })

  it('shares the alt text with the slot token, not replacing it', () => {
    // Both markers live in the one field EXP-8 already uses
    const alt = [slotToken('photo'), creditToken(tasl)].join('\n')
    expect(slotFromToken(alt)).toBe('photo')
    expect(creditFromToken(alt)?.creator).toBe('Ada Lovelace')
  })

  it('leaves a real description alone, which belongs to the user', () => {
    const alt = [
      'A diagram of a cell',
      slotToken('photo'),
      creditToken(tasl),
    ].join('\n')
    expect(creditFromToken(alt)?.license).toBe('CC BY-SA 4.0')
  })
})

describe('alt text that is not ours', () => {
  it('reads as no credit rather than as a broken import', () => {
    // A human can edit this field, so anything shaped like ours but invalid
    // is treated as theirs
    expect(creditFromToken('credit:{not json')).toBeUndefined()
    expect(creditFromToken('credit:["a","list"]')).toBeUndefined()
    expect(creditFromToken('just a description')).toBeUndefined()
    expect(creditFromToken(undefined)).toBeUndefined()
  })

  it('keeps only the fields TASL defines', () => {
    const alt = 'credit:{"creator":"Ada","evil":"<script>","count":7}'
    expect(creditFromToken(alt)).toEqual({ creator: 'Ada' })
  })

  it('drops a payload too large to be a credit rather than truncating it', () => {
    // Half a licence is worse than none: it reads as complete
    const huge = { creator: 'a'.repeat(MAX_CREDIT_PAYLOAD) }
    expect(creditToken(huge)).toBeUndefined()
  })
})
