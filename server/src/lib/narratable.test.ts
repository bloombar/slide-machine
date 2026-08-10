/**
 * Unit tests for what of a slide is read aloud (EDIT-7).
 *
 * The prohibition is the point: narration must not recite a formula's LaTeX or
 * a program listing's punctuation. Those are not what the lecturer said and
 * not what a listener can follow, so they contribute nothing — while the prose
 * in boxes an author named must still be heard, or a slide whose substance
 * lives in a box called "takeaway" narrates as though it were blank.
 */
import { describe, it, expect } from 'vitest'
import { narratableText } from './narratable'

describe('what a slide contributes to what is said', () => {
  it('includes the prose in a box the author named', () => {
    expect(
      narratableText({
        takeaway: { kind: 'text', value: 'Rain is free; storage is not.' },
      }),
    ).toEqual(['Rain is free; storage is not.'])
  })

  it('includes a list of points', () => {
    expect(
      narratableText({
        steps: { kind: 'bullets', items: ['Collect', 'Filter', 'Store'] },
      }),
    ).toEqual(['Collect', 'Filter', 'Store'])
  })

  it('includes preformatted text, whose words are still words', () => {
    expect(
      narratableText({
        recipe: {
          kind: 'preformatted',
          value: 'one part sand\ntwo parts gravel',
        },
      }),
    ).toEqual(['one part sand\ntwo parts gravel'])
  })

  it('says nothing of a formula', () => {
    // "backslash frac open brace one close brace open brace two close brace"
    expect(
      narratableText({ eq: { kind: 'math', tex: '\\frac{1}{2}gt^2' } }),
    ).toEqual([])
  })

  it('says nothing of a program listing', () => {
    expect(
      narratableText({
        sample: {
          kind: 'code',
          source: 'for i in range(10):\n    print(i)',
          language: 'python',
        },
      }),
    ).toEqual([])
  })

  it('says nothing of a table', () => {
    // A grid read out cell by cell loses the only thing that made it a grid
    expect(
      narratableText({
        data: { kind: 'table', header: ['Year'], rows: [['2024'], ['2025']] },
      }),
    ).toEqual([])
  })

  it('says nothing of a picture', () => {
    expect(
      narratableText({ figure: { kind: 'image', ref: 'http://x/a.png' } }),
    ).toEqual([])
  })

  it('leaves the conventional boxes to the fields that already carry them', () => {
    // They are sent as themselves; repeating them would have the narration
    // hear the title twice
    expect(
      narratableText({
        title: { kind: 'text', value: 'Rainwater' },
        body: { kind: 'text', value: 'An overview' },
        bullets: { kind: 'bullets', items: ['One'] },
        caption: { kind: 'text', value: 'A barrel' },
      }),
    ).toEqual([])
  })

  it('skips a box that is empty or only spaces', () => {
    expect(
      narratableText({
        blank: { kind: 'text', value: '   ' },
        empty: { kind: 'bullets', items: ['', ' '] },
      }),
    ).toEqual([])
  })

  it('says nothing for a slide with no boxes at all', () => {
    expect(narratableText(undefined)).toEqual([])
  })
})
