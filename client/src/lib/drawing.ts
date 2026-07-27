/**
 * Pure geometry helpers for the whiteboard (WB-1). Strokes are stored with
 * coordinates normalized 0..1 to a slide's rendered box, so these convert to
 * and from that space, hit-test whole strokes for the eraser, and pick which
 * slide a stroke belongs to in list view. Kept free of the DOM/React so they
 * can be unit-tested in isolation.
 */
import type {
  Stroke,
  StrokeAnchor,
  StrokePoint,
  TtsMark,
} from '@slide-machine/shared'
import { anchorFraction, charTimeFromMarks } from '@slide-machine/shared'

/** Live playback position: which slide, and how far through its audio. When the
 * clip carries `<mark>` timepoints, strokes reveal by real elapsed time
 * (`currentTime` vs. the mark-interpolated time); otherwise the linear
 * `fraction` proxy is used. Null overall = nothing playing. */
export interface PlaybackProgress {
  index: number
  fraction: number | null
  currentTime?: number
  duration?: number | null
  marks?: TtsMark[]
}

/**
 * Whether a stroke should be visible now (WB-2). Outside playback (`progress`
 * null) every non-erased stroke shows. During playback, a stroke on an already-
 * narrated slide shows if never erased; on the slide being narrated it appears
 * at its draw anchor and disappears at its erase anchor; on a slide not yet
 * reached it is hidden — EXCEPT `unsynced` marks (drawn with the mic off),
 * which aren't tied to narration and are always shown unless erased, on any
 * slide, so flipping to that slide always reveals them. An `orphaned` mark (its
 * phrase was removed by a transcript refine or hand-edit) is hidden outright —
 * in the editing view as well as during playback — but never deleted.
 *
 * On the active slide, reveal time comes from the clip's `<mark>` timepoints
 * (real spoken time of each phrase boundary) when present, so pauses and speech
 * rate are honored; without marks it falls back to the linear char-fraction.
 */
export const strokeVisible = (
  stroke: Stroke,
  slideIndex: number,
  transcriptLength: number,
  progress: PlaybackProgress | null,
): boolean => {
  if (stroke.anchor.orphaned) return false
  if (stroke.anchor.source === 'unsynced') return !stroke.erasedAnchor
  if (!progress || slideIndex < 0) return !stroke.erasedAnchor
  if (slideIndex < progress.index) return !stroke.erasedAnchor
  if (slideIndex > progress.index) return false
  // On the active slide, has the clock passed this anchor's time yet?
  const reached = (anchor: StrokeAnchor): boolean => {
    if (progress.marks?.length && progress.duration) {
      const target = charTimeFromMarks(
        anchor.charAnchor,
        progress.marks,
        progress.duration,
        transcriptLength,
      )
      return (progress.currentTime ?? 0) >= target
    }
    const frac = progress.fraction ?? 1
    return anchorFraction(anchor.charAnchor, transcriptLength) <= frac
  }
  const drawn = reached(stroke.anchor)
  const erased = stroke.erasedAnchor ? reached(stroke.erasedAnchor) : false
  return drawn && !erased
}

/**
 * Whether erasing this stroke should be RETAINED as a timestamped event (so
 * playback can replay the removal in sync) rather than just deleted. That is
 * only meaningful when BOTH the stroke's draw and the erase are tied to the
 * transcript: an `unsynced` mark (drawn mic-off) is always shown with no
 * timeline, and an erase made mic-off has no transcript position — either way
 * there is nothing to replay, so the stroke is simply removed (WB-2).
 */
export const erasureReplays = (
  stroke: Stroke,
  eraseAnchor: StrokeAnchor,
): boolean =>
  stroke.anchor.source !== 'unsynced' && eraseAnchor.source !== 'unsynced'

/** A rendered slide box in client (viewport) coordinates. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Client point → normalized 0..1 within `box`. Values are NOT clamped so the
 * caller can decide; the server clamps on save. */
export const normalizePoint = (
  clientX: number,
  clientY: number,
  box: Box,
): StrokePoint => ({
  x: box.width ? (clientX - box.left) / box.width : 0,
  y: box.height ? (clientY - box.top) / box.height : 0,
})

/** Normalized 0..1 point → client coordinates within `box`. */
export const denormalizePoint = (
  point: StrokePoint,
  box: Box,
): { x: number; y: number } => ({
  x: box.left + point.x * box.width,
  y: box.top + point.y * box.height,
})

/** Mean of a stroke's points (its center of mass), in whatever space the
 * points are given. Returns null for an empty point list. */
export const strokeCentroid = (points: StrokePoint[]): StrokePoint | null => {
  if (!points.length) return null
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / points.length, y: sy / points.length }
}

/** Shortest distance from point (px,py) to segment (ax,ay)-(bx,by). */
export const pointSegmentDistance = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  // Degenerate segment (a == b): distance to the point.
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Whether a client point hits a stroke, for whole-stroke erase. Works in pixel
 * space (converting the stroke's normalized points via `box`) so the tolerance
 * reads the same horizontally and vertically despite the 16:9 aspect. A hit is
 * within half the stroke's rendered width plus a fixed grab tolerance.
 */
export const hitTestStroke = (
  clientX: number,
  clientY: number,
  stroke: Stroke,
  box: Box,
  tolerancePx = 6,
): boolean => {
  const pts = stroke.points
  if (!pts.length) return false
  // thickness is normalized to slide width, so scale by width for pixels.
  const reach = (stroke.thickness * box.width) / 2 + tolerancePx
  const toPx = (p: StrokePoint) => denormalizePoint(p, box)
  // A single-point stroke (a dot) has no segment — test the point itself.
  if (pts.length === 1) {
    const a = toPx(pts[0]!)
    return Math.hypot(clientX - a.x, clientY - a.y) <= reach
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = toPx(pts[i]!)
    const b = toPx(pts[i + 1]!)
    if (pointSegmentDistance(clientX, clientY, a.x, a.y, b.x, b.y) <= reach)
      return true
  }
  return false
}

/** A candidate slide box for list-view stroke assignment. */
export interface SlideBox {
  slideId: string
  box: Box
}

/**
 * Picks the slide whose box center is nearest a stroke's centroid (given in
 * client coordinates) — the list-view "which slide did they draw on?" rule,
 * mirroring the nearest-center logic the nav already uses. Returns null when
 * there are no candidates.
 */
export const nearestSlideToCentroid = (
  centroid: { x: number; y: number },
  slides: SlideBox[],
): string | null => {
  let bestId: string | null = null
  let bestDist = Infinity
  for (const { slideId, box } of slides) {
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const dist = Math.hypot(centroid.x - cx, centroid.y - cy)
    if (dist < bestDist) {
      bestDist = dist
      bestId = slideId
    }
  }
  return bestId
}
