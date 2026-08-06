/**
 * The arithmetic of moving boxes around a slide.
 *
 * Boxes are fractions of the slide, 0–1, so this is the same maths at any
 * render size — a thumbnail and the full-bleed viewer agree. Kept apart from
 * the canvas that calls it because it is the part worth testing exhaustively,
 * and because a drag and an arrow key must produce identical numbers: neither
 * route is a lesser path.
 */
import type { LayoutGuides, ThemeMetricsLike } from './types'

/** What one arrow-key press moves or resizes a box by: two percent of the
 * slide, in the stored 0–1 scale. */
export const NUDGE = 0.02

/** The grid the rulers mark and guides snap to: every ten percent. */
export const TICK = 0.1

/** The smallest box worth having — below this there is nothing to grab. */
export const MIN_SIDE = 0.05

/** How near an edge must come before it snaps. */
export const SNAP_TOLERANCE = 0.015

/** Which way each arrow points, as a delta. */
export const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Keeps a box inside the slide and larger than a hairline, whichever way it
 * was moved. */
export const clampBox = <T extends Box>(box: T): T => {
  const w = Math.min(1, Math.max(MIN_SIDE, box.w))
  const h = Math.min(1, Math.max(MIN_SIDE, box.h))
  return {
    ...box,
    w,
    h,
    x: Math.min(1 - w, Math.max(0, box.x)),
    y: Math.min(1 - h, Math.max(0, box.y)),
  }
}

/** Rounds a value to the nearest ruler tick. */
export const snapToTicks = (v: number): number => Math.round(v / TICK) * TICK

/** The lines an edge may snap to on one axis: the slide's own margins, its
 * centre, and every guide the author pulled out. */
export const snapLines = (margin: number, guides: number[] = []): number[] => [
  margin,
  0.5,
  1 - margin,
  ...guides,
]

const nearest = (v: number, lines: number[]): number | undefined => {
  let best: number | undefined
  let bestGap = SNAP_TOLERANCE
  for (const line of lines) {
    const gap = Math.abs(v - line)
    if (gap < bestGap) {
      bestGap = gap
      best = line
    }
  }
  return best
}

/**
 * Pulls a box's edges onto nearby lines.
 *
 * Only the leading edge moves the box; catching the trailing edge resizes
 * nothing, it slides the box so that edge lands on the line — which is what
 * someone dragging a box towards a guide means by it.
 *
 * Pointer drags only. An arrow key is the exact route, and snapping it would
 * make the two disagree.
 */
export const snapBox = <T extends Box>(
  box: T,
  metrics: ThemeMetricsLike,
  guides?: LayoutGuides,
): T => {
  /** Where the box should start, given which of its edges caught a line. */
  const axis = (start: number, size: number, lines: number[]): number => {
    const leading = nearest(start, lines)
    if (leading !== undefined) return leading
    const trailing = nearest(start + size, lines)
    return trailing === undefined ? start : trailing - size
  }
  return {
    ...box,
    x: axis(box.x, box.w, snapLines(metrics.marginX, guides?.x)),
    y: axis(box.y, box.h, snapLines(metrics.marginY, guides?.y)),
  }
}

/**
 * A starting arrangement: the boxes stacked down the slide inside its
 * margins. Computed from however many there are rather than written down, so
 * it fits a layout with two and one with six.
 */
export const stackBoxes = (count: number, metrics: ThemeMetricsLike): Box[] => {
  if (count < 1) return []
  const usableW = 1 - metrics.marginX * 2
  const usableH = 1 - metrics.marginY * 2
  const height = (usableH - metrics.gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({
    x: metrics.marginX,
    y: metrics.marginY + i * (height + metrics.gap),
    w: usableW,
    h: Math.max(MIN_SIDE, height),
  }))
}
