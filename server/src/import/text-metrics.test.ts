/**
 * How much a box holds, and how much room what it holds needs (TMPL-8).
 *
 * Both answers are arithmetic — there is no browser on the server — so the
 * numbers here are worked by hand from the same constants the module uses: a
 * character is half the type size wide, a line is one and a half times it
 * tall, and a 16:9 slide is 56.25 `cqi` deep.
 *
 * Exact numbers rather than "about right", because two readers depend on this
 * agreeing with itself: the box that gets grown to fit its content, and the
 * budget a derived text role is given. Drift between them is the whole thing
 * this module exists to prevent.
 */
import { describe, it, expect } from 'vitest'
import type { CandidateSlot } from './candidate'
import { capacityOf, heightForText } from './text-metrics'

const slot = (over: Partial<CandidateSlot> = {}): CandidateSlot => ({
  name: 'body',
  kind: 'text',
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
  ...over,
})

describe('what a box can hold', () => {
  it('is how many characters fit across times how many lines fit down', () => {
    // 80cqi wide at 4cqi type is 40 characters; 16.875cqi deep is 2 lines
    expect(capacityOf(slot({ fontSize: 4 }))).toEqual({ maxChars: 80 })
  })

  it('counts a list’s characters per point rather than per box', () => {
    // A point is one line of the box, so its bound is one line's worth
    expect(capacityOf(slot({ kind: 'bullets', fontSize: 4 }))).toEqual({
      maxChars: 40,
      maxItems: 2,
    })
  })

  it('never bounds a box at nothing, however small it is drawn', () => {
    // A box too small for one character still has to accept one
    expect(
      capacityOf(slot({ box: { x: 0, y: 0, w: 0.01, h: 0.01 }, fontSize: 10 })),
    ).toEqual({ maxChars: 1 })
  })

  it('keeps the point count inside what the template schema accepts', () => {
    // 75 lines fit, but `maxItems` is bounded at 50 and an unclamped value
    // would fail `layoutSchema` and reject the whole imported layout
    expect(
      capacityOf(
        slot({
          kind: 'bullets',
          box: { x: 0, y: 0, w: 0.5, h: 1 },
          fontSize: 0.5,
        }),
      ),
    ).toEqual({ maxChars: 200, maxItems: 50 })
  })

  it('bounds a box in whole characters, which is what the schema takes', () => {
    // `maxChars` is an integer in the schema; a fractional one is rejected
    const { maxChars } = capacityOf(slot({ fontSize: 3 }))
    expect(Number.isInteger(maxChars)).toBe(true)
  })

  it('says nothing about a box that holds no text', () => {
    // A picture holds no words and a table's shape is its rows, not a count
    expect(capacityOf(slot({ kind: 'image', fontSize: 4 }))).toEqual({})
    expect(capacityOf(slot({ kind: 'table', fontSize: 4 }))).toEqual({})
  })

  it('says nothing about a box whose source never stated a type size', () => {
    // Without a size there is no arithmetic to do, and a guess would bound
    // the box at a number nothing measured
    expect(capacityOf(slot())).toEqual({})
  })
})

describe('the room a box’s own content needs', () => {
  it('is nothing when the deck never said what the box held', () => {
    expect(heightForText(slot({ fontSize: 4 }))).toBe(0)
    expect(heightForText(slot({ held: { lines: 3, longest: 20 } }))).toBe(0)
  })

  it('is the lines it holds, at the height a line takes', () => {
    // Two lines of 4cqi type, each 1.5 times its size, over a 56.25cqi slide
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 10 } })),
    ).toBeCloseTo(12 / 56.25, 10)
  })

  it('gives a line that runs past the box the rows it will wrap onto', () => {
    // 100 characters across a 40-character box is three rows, not one — a
    // box measured at one row hides the other two
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 100 } })),
    ).toBeCloseTo(36 / 56.25, 10)
  })

  it('asks for more room for the same text set larger', () => {
    const held = { lines: 3, longest: 60 }
    expect(heightForText(slot({ fontSize: 6, held }))).toBeGreaterThan(
      heightForText(slot({ fontSize: 3, held })),
    )
  })

  it('agrees with what the box was said to hold', () => {
    // The two readings of one estimate: a box given exactly its capacity
    // should need about exactly its own height, not several times it
    const s = slot({ fontSize: 4 })
    const { maxChars } = capacityOf(s)
    const needed = heightForText({
      ...s,
      held: { lines: 1, longest: maxChars! },
    })
    expect(needed).toBeLessThanOrEqual(s.box.h + 0.001)
  })
})

describe('the edges a real deck actually reaches', () => {
  it('treats a stated size of zero as no size at all', () => {
    // A source can state 0 rather than omit the field, and dividing by it
    // would bound the box at Infinity characters
    expect(capacityOf(slot({ fontSize: 0 }))).toEqual({})
    expect(
      heightForText(slot({ fontSize: 0, held: { lines: 3, longest: 20 } })),
    ).toBe(0)
  })

  it('still gives a box drawn with no width a character to hold', () => {
    // A zero-width shape is degenerate but importable, and a bound of zero
    // would tell the AI the box takes nothing
    expect(
      capacityOf(slot({ box: { x: 0, y: 0, w: 0, h: 0.3 }, fontSize: 4 })),
    ).toEqual({ maxChars: 2 })
  })

  it('gives an empty line the room of a line', () => {
    // A blank paragraph is still a paragraph; measuring it at no rows would
    // pull everything below it up over the text
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 0 } })),
    ).toBeCloseTo(12 / 56.25, 10)
  })

  it('asks for no room for a box measured as holding nothing', () => {
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 0, longest: 50 } })),
    ).toBe(0)
  })
})
