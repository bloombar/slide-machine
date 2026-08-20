/**
 * Unit tests for how far an exporter shrinks a box's type (EXP-1).
 *
 * The screen measures with a browser; an exporter lays the text out itself and
 * asks the same question of its own measurement. Without it the exporters drew
 * every line from the top of the box whatever its height, so a slide holding
 * more than its design allows ran off the bottom of the box and off the page —
 * a file that was a different lecture from the one its author saw.
 */
import { describe, it, expect } from 'vitest'
import { fitScale, estimatedHeight, MIN_FIT_SCALE } from './fit-scale'

/**
 * A box whose content is `tall` at full size and shrinks with the type.
 *
 * Deliberately not proportional: re-wrapping at a smaller size gives fewer
 * lines, and the last of them a different length, so height falls away faster
 * than the type does. That is why the search steps rather than solving.
 */
const contentOf = (tall: number) => (scale: number) => tall * scale * 0.9

describe('how far to shrink a box', () => {
  it('leaves a box that already fits at full size', () => {
    expect(fitScale(contentOf(50), 100)).toBe(1)
  })

  it('shrinks a box that does not', () => {
    expect(fitScale(contentOf(200), 100)).toBeLessThan(1)
  })

  it('shrinks only as far as it has to', () => {
    // A box a little over should come back a little smaller, so the slide
    // still looks like itself.
    const scale = fitScale(contentOf(115), 100)
    expect(scale).toBeGreaterThan(0.8)
    expect(scale).toBeLessThan(1)
  })

  it('stops at the floor when a slide holds far too much', () => {
    // Past it the honest answer is that the slide holds too much, and it is
    // left legible rather than shrunk into a smear.
    expect(fitScale(contentOf(10_000), 100)).toBe(MIN_FIT_SCALE)
  })

  it('never returns a scale whose content still overflows, unless floored', () => {
    for (const tall of [101, 140, 199, 240]) {
      const scale = fitScale(contentOf(tall), 100)
      if (scale > MIN_FIT_SCALE)
        expect(contentOf(tall)(scale)).toBeLessThanOrEqual(100)
    }
  })

  it('leaves a box with no height alone', () => {
    // Nothing to reason about; shrinking against nothing would take every
    // such box to the floor.
    expect(fitScale(contentOf(200), 0)).toBe(1)
  })

  it('asks the caller to lay the text out again at each size', () => {
    // The height cannot be scaled arithmetically: fewer lines, and the last
    // of them a different length.
    const asked: number[] = []
    fitScale(scale => {
      asked.push(scale)
      return 200 * scale
    }, 100)
    expect(asked.length).toBeGreaterThan(1)
    expect(asked[0]).toBe(1)
  })
})

describe('estimating how tall text comes out', () => {
  it('gives one line about one line of height', () => {
    const h = estimatedHeight(['short'], 10, 1000)
    expect(h).toBeGreaterThan(10)
    expect(h).toBeLessThan(20)
  })

  it('counts more lines as taller', () => {
    const one = estimatedHeight(['a'], 10, 1000)
    expect(estimatedHeight(['a', 'b', 'c'], 10, 1000)).toBeCloseTo(one * 3)
  })

  it('counts a line too long for the box as the rows it wraps to', () => {
    // The point of the estimate: PowerPoint wraps, and text that wraps is
    // taller than the one line it was written as.
    const narrow = estimatedHeight(['x'.repeat(100)], 10, 100)
    const wide = estimatedHeight(['x'.repeat(100)], 10, 10_000)
    expect(narrow).toBeGreaterThan(wide * 4)
  })

  it('counts an empty line as a line, because it takes up one', () => {
    expect(estimatedHeight([''], 10, 1000)).toBeGreaterThan(0)
  })

  it('grows with the type size', () => {
    expect(estimatedHeight(['some words'], 20, 1000)).toBeGreaterThan(
      estimatedHeight(['some words'], 10, 1000),
    )
  })

  it('has no answer for a box with no width or type with no size', () => {
    expect(estimatedHeight(['words'], 10, 0)).toBe(0)
    expect(estimatedHeight(['words'], 0, 1000)).toBe(0)
  })
})

describe('the two together, as an exporter uses them', () => {
  /** Shrinks a box the way the PowerPoint exporter does. */
  const scaleFor = (lines: string[], size: number, w: number, h: number) =>
    fitScale(at => estimatedHeight(lines, size * at, w), h)

  it('leaves a slide the app wrote at full size', () => {
    // Generated decks are written to the box's limits, so the common case must
    // not shrink: a fit that touched every slide would be a restyling.
    expect(scaleFor(['Key points'], 30, 800, 100)).toBe(1)
  })

  it('shrinks a box holding far more than its design allows', () => {
    const dense = Array.from({ length: 20 }, () => 'A full line of prose here')
    expect(scaleFor(dense, 30, 800, 100)).toBeLessThan(1)
  })
})
