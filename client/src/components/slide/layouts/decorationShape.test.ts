/**
 * The outline a decoration piece is cut to (TMPL-8).
 *
 * A deck's arrow imported as a grey rectangle, because the reader kept where
 * a shape was and threw away what it was. These check the mapping that draws
 * it — and, as much, that an unknown shape falls back to the rectangle it is
 * bounded by rather than to nothing at all.
 */
import { describe, it, expect } from 'vitest'
import { clipPathFor } from './decorationShape'

describe('clipPathFor', () => {
  it('cuts an arrow to an arrow', () => {
    const clip = clipPathFor('RIGHT_ARROW')
    expect(clip).toMatch(/^polygon\(/)
    // A head that reaches the right edge at the vertical middle
    expect(clip).toContain('100% 50%')
  })

  it('knows the arrows a deck is actually built from', () => {
    for (const shape of [
      'LEFT_ARROW',
      'UP_ARROW',
      'DOWN_ARROW',
      'LEFT_RIGHT_ARROW',
      'BENT_ARROW',
      'CHEVRON',
    ]) {
      expect(clipPathFor(shape), shape).toMatch(/^polygon\(/)
    }
  })

  it('cuts a round shape to an ellipse rather than a polygon', () => {
    expect(clipPathFor('ELLIPSE')).toBe('ellipse(50% 50% at 50% 50%)')
    expect(clipPathFor('CIRCLE')).toBe('ellipse(50% 50% at 50% 50%)')
  })

  it('does not care how the presentation cased the name', () => {
    expect(clipPathFor('right_arrow')).toBe(clipPathFor('RIGHT_ARROW'))
  })

  it('leaves a rectangle alone, which is what a band or a rule is', () => {
    expect(clipPathFor('RECTANGLE')).toBeUndefined()
    expect(clipPathFor('TEXT_BOX')).toBeUndefined()
    expect(clipPathFor(undefined)).toBeUndefined()
  })

  it('falls back to the bounding rectangle for a shape it does not know', () => {
    // Google names about a hundred and eighty; drawing an unknown one as the
    // box it occupies is plain, never wrong
    expect(clipPathFor('CLOUD_CALLOUT')).toBeUndefined()
    expect(clipPathFor('WAVE')).toBeUndefined()
  })
})
