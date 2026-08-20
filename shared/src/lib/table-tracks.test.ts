/**
 * Unit tests for a table's column widths and row heights (EDIT-7).
 *
 * Four surfaces draw a table — the viewer, the editor, the PDF and the
 * PowerPoint — and each used to split the box into equal columns on its own.
 * They now read the sizes through here, so what is tested is the arithmetic all
 * four share: that it always returns a usable list, whatever was stored.
 */
import { describe, it, expect } from 'vitest'
import {
  tableTracks,
  tableColumnCount,
  resizeTrack,
  MIN_TRACK,
} from './table-tracks'

/** Fractions should sum to one; floating point means "about". */
const sums = (out: number[]) => out.reduce((a, b) => a + b, 0)

describe('how a table divides its box', () => {
  it('splits it equally when nothing was chosen', () => {
    // Every table before this existed, and every table nobody has dragged.
    expect(tableTracks(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('keeps the sizes it was given', () => {
    expect(tableTracks([0.6, 0.4], 2)).toEqual([0.6, 0.4])
  })

  it('gives a column added since the sizes were stored an even share', () => {
    // The alternative — resetting the table — throws away the author's work
    // because they added a column.
    const out = tableTracks([0.5, 0.25], 3)
    expect(out[0]).toBeCloseTo(0.5)
    expect(out[1]).toBeCloseTo(0.25)
    expect(out[2]).toBeCloseTo(0.25)
  })

  it('drops sizes for columns that are gone', () => {
    expect(tableTracks([0.5, 0.3, 0.2], 2)).toHaveLength(2)
    expect(sums(tableTracks([0.5, 0.3, 0.2], 2))).toBeCloseTo(1)
  })

  it('always sums to one, so the table fills its box exactly', () => {
    for (const stored of [
      undefined,
      [0.9, 0.9, 0.9],
      [0.01],
      [0.5, 0.5, 0.5, 0.5],
    ]) {
      expect(sums(tableTracks(stored, 3))).toBeCloseTo(1)
    }
  })

  it('ignores a size that could not be a size', () => {
    // A zero, a negative or a NaN from a hand-edited deck would otherwise
    // collapse a column to nothing, taking its content with it.
    const out = tableTracks([0, -1, Number.NaN, 0.5], 4)
    expect(out.every(n => n > 0)).toBe(true)
    expect(sums(out)).toBeCloseTo(1)
  })

  it('has nothing to say about a table with no columns', () => {
    expect(tableTracks([0.5], 0)).toEqual([])
  })
})

describe('how many columns a table has', () => {
  it('counts the widest row', () => {
    expect(tableColumnCount([['a'], ['a', 'b', 'c']])).toBe(3)
  })

  it('counts a header wider than any row', () => {
    expect(tableColumnCount([['a']], ['a', 'b'])).toBe(2)
  })

  it('says one for a table with nothing in it, so it still draws', () => {
    expect(tableColumnCount([])).toBe(1)
  })
})

describe('dragging a boundary between two tracks', () => {
  it('takes from the neighbour exactly what it gives', () => {
    // The rest of the table must not shift: dragging one edge is one edit, not
    // a re-proportioning of every column to its right.
    const out = resizeTrack(undefined, 3, 0, 0.1)
    expect(out[0]).toBeCloseTo(1 / 3 + 0.1)
    expect(out[1]).toBeCloseTo(1 / 3 - 0.1)
    expect(out[2]).toBeCloseTo(1 / 3)
    expect(sums(out)).toBeCloseTo(1)
  })

  it('lets a boundary be dragged back the other way', () => {
    const out = resizeTrack(undefined, 2, 0, -0.2)
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(0.7)
  })

  it('will not drag a track away to nothing', () => {
    // A column with no width has no edge left to grab, so the drag would be
    // impossible to undo.
    const out = resizeTrack(undefined, 2, 0, 5)
    expect(out[1]).toBeGreaterThanOrEqual(MIN_TRACK)
    expect(out[0]).toBeCloseTo(1 - MIN_TRACK)
  })

  it('will not drag itself away to nothing either', () => {
    const out = resizeTrack(undefined, 2, 0, -5)
    expect(out[0]).toBeCloseTo(MIN_TRACK)
  })

  it('leaves the last track alone, since its edge is the table’s own', () => {
    const before = tableTracks(undefined, 3)
    expect(resizeTrack(undefined, 3, 2, 0.1)).toEqual(before)
  })

  it('keeps the total at one however many times it is dragged', () => {
    let sizes = tableTracks(undefined, 4)
    for (const [i, by] of [
      [0, 0.05],
      [1, -0.07],
      [2, 0.2],
      [0, -0.9],
    ] as [number, number][]) {
      sizes = resizeTrack(sizes, 4, i, by)
      expect(sums(sizes)).toBeCloseTo(1)
      expect(sizes.every(n => n >= MIN_TRACK - 1e-9)).toBe(true)
    }
  })
})
