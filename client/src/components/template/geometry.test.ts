/**
 * Unit tests for the box arithmetic. No DOM: this is the part that decides
 * where a box ends up, and it should be provable without laying anything out.
 */
import { describe, it, expect } from 'vitest'
import {
  ARROWS,
  MIN_SIDE,
  NUDGE,
  TICK,
  clampBox,
  snapBox,
  snapLines,
  snapToTicks,
  stackBoxes,
} from './geometry'

const metrics = { marginX: 0.06, marginY: 0.06, gap: 0.03 }

describe('clampBox', () => {
  it('keeps a box inside the slide', () => {
    expect(clampBox({ x: -0.5, y: 1.4, w: 0.3, h: 0.2 })).toMatchObject({
      x: 0,
      y: 0.8,
    })
  })

  it('will not shrink a box below something you can grab', () => {
    const box = clampBox({ x: 0.1, y: 0.1, w: 0.001, h: -1 })
    expect(box.w).toBe(MIN_SIDE)
    expect(box.h).toBe(MIN_SIDE)
  })

  it('will not grow a box past the slide', () => {
    expect(clampBox({ x: 0, y: 0, w: 4, h: 9 })).toMatchObject({ w: 1, h: 1 })
  })

  it('keeps whatever else the box was carrying', () => {
    // A box holds its styling too, and moving it must not strip that.
    const styled = { x: 0.1, y: 0.1, w: 0.5, h: 0.5, fontSize: 4 }
    expect(clampBox(styled).fontSize).toBe(4)
  })
})

describe('snapToTicks', () => {
  it('rounds to the nearest ruler mark', () => {
    expect(snapToTicks(0.42)).toBeCloseTo(0.4, 5)
    expect(snapToTicks(0.46)).toBeCloseTo(0.5, 5)
    expect(snapToTicks(0)).toBe(0)
  })

  it('marks every ten percent', () => {
    expect(TICK).toBe(0.1)
  })
})

describe('snapLines', () => {
  it('offers the margins, the centre, and every guide', () => {
    expect(snapLines(0.06, [0.25])).toEqual([0.06, 0.5, 0.94, 0.25])
  })
})

describe('snapBox', () => {
  it('pulls a leading edge onto a margin', () => {
    const box = { x: 0.065, y: 0.4, w: 0.3, h: 0.2 }
    expect(snapBox(box, metrics).x).toBeCloseTo(0.06, 5)
  })

  it('slides a box so its trailing edge lands on a line', () => {
    // Dragging a box's right edge towards the right margin means the box
    // moves; it does not resize.
    const box = { x: 0.63, y: 0.4, w: 0.3, h: 0.2 }
    const snapped = snapBox(box, metrics)
    expect(snapped.x + snapped.w).toBeCloseTo(0.94, 5)
    expect(snapped.w).toBe(0.3)
  })

  it('snaps to a guide the author pulled out', () => {
    const box = { x: 0.248, y: 0.4, w: 0.3, h: 0.2 }
    expect(snapBox(box, metrics, { x: [0.25], y: [] }).x).toBeCloseTo(0.25, 5)
  })

  it('leaves a box alone when nothing is near', () => {
    // Both edges well clear of 0.06, 0.5 and 0.94 on each axis.
    const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }
    expect(snapBox(box, metrics)).toMatchObject({ x: 0.2, y: 0.2 })
  })

  it('prefers the leading edge when both could catch', () => {
    // A box exactly as wide as the safe area has both edges on a margin;
    // honouring the leading one leaves it where it is.
    const box = { x: 0.06, y: 0.4, w: 0.88, h: 0.2 }
    expect(snapBox(box, metrics).x).toBeCloseTo(0.06, 5)
  })
})

describe('stackBoxes', () => {
  it('stacks boxes down the slide inside its margins', () => {
    const boxes = stackBoxes(3, metrics)
    expect(boxes).toHaveLength(3)
    expect(boxes[0]).toMatchObject({ x: 0.06, y: 0.06, w: 0.88 })
    // Every box sits inside the slide
    for (const b of boxes) {
      expect(b.y).toBeGreaterThanOrEqual(0.06)
      expect(b.y + b.h).toBeLessThanOrEqual(0.941)
    }
  })

  it('leaves the gap between them the theme asked for', () => {
    const [first, second] = stackBoxes(2, metrics)
    expect(second!.y - (first!.y + first!.h)).toBeCloseTo(metrics.gap, 5)
  })

  it('fits however many boxes there are', () => {
    expect(stackBoxes(6, metrics)).toHaveLength(6)
    expect(stackBoxes(0, metrics)).toEqual([])
  })
})

describe('nudging', () => {
  it('moves two percent of the slide per press', () => {
    expect(NUDGE).toBe(0.02)
  })

  it('points each arrow the way it looks', () => {
    expect(ARROWS.ArrowLeft).toEqual({ dx: -1, dy: 0 })
    expect(ARROWS.ArrowDown).toEqual({ dx: 0, dy: 1 })
  })
})
