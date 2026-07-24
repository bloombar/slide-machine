/**
 * Pure helpers for whiteboard stroke timing (WB-2). A stroke's timing is a
 * character offset into the slide's `sourceTranscript` (`StrokeAnchor.charAnchor`);
 * these turn that offset into a proportional position and rescale it when the
 * transcript is rewritten by refinement. Shared by the server refine pass and
 * the client playback overlay so both agree on the math.
 */
import type { Stroke } from '../types/deck'
import type { TtsMark } from '../providers/tts'

/**
 * Whether a slide carries any *visible* whiteboard marks. Erased strokes stay
 * in the array (flagged with `erasedAnchor`) for replay, so a plain length
 * check would count marks the user has already removed; this ignores those.
 * Used to guard content-reflowing generation/refinement on marked-up slides.
 */
export const hasVisibleDrawings = (drawings?: Stroke[]): boolean =>
  (drawings ?? []).some(s => !s.erasedAnchor)

/**
 * Position of an anchor within the narration, in [0, 1]. Uses transcript length
 * as a monotonic proxy for time so playback can project it onto TTS audio
 * duration. Guards a zero-length transcript (returns 0) and clamps to [0, 1].
 */
export const anchorFraction = (
  charAnchor: number,
  transcriptLength: number,
): number => {
  if (transcriptLength <= 0) return 0
  const fraction = charAnchor / transcriptLength
  if (fraction < 0) return 0
  if (fraction > 1) return 1
  return fraction
}

/**
 * Rescales a character anchor when a slide's transcript is replaced (refine
 * overwrites `sourceTranscript` wholesale, with no word alignment). Keeps the
 * anchor at the same proportional point of the new narration. A zero-length old
 * transcript can't be scaled, so the anchor collapses to 0 (start).
 */
export const remapAnchor = (
  charAnchor: number,
  oldLength: number,
  newLength: number,
): number => {
  if (oldLength <= 0) return 0
  return Math.round((charAnchor / oldLength) * newLength)
}

/**
 * Real audio time (seconds) of a character position, from TTS `<mark>`
 * timepoints. Marks give the true spoken time of sentence boundaries, so this
 * interpolates linearly between the two marks bracketing `charAnchor` — a
 * piecewise-linear char→time curve that tracks pauses and speech rate, unlike
 * the flat `charAnchor / length` proxy. Marks must be sorted by `charOffset`.
 *
 * Falls back to `anchorFraction(charAnchor, textLength) * duration` when there
 * are no marks (non-SSML voices, mock/browser engines), so playback still works
 * everywhere. Before the first mark or after the last, it extrapolates from the
 * clip's start (0) / end (`duration`) so early and late marks stay in sync.
 */
export const charTimeFromMarks = (
  charAnchor: number,
  marks: TtsMark[],
  duration: number,
  textLength: number,
): number => {
  if (!marks.length || duration <= 0) {
    return anchorFraction(charAnchor, textLength) * Math.max(0, duration)
  }
  // Bracket the anchor: `lo` is the last mark at or before it, `hi` the first
  // after. Endpoints outside the mark range anchor to clip start/end.
  let lo: TtsMark | null = null
  let hi: TtsMark | null = null
  for (const m of marks) {
    if (m.charOffset <= charAnchor) lo = m
    else {
      hi = m
      break
    }
  }
  const start = lo ?? { charOffset: 0, timeSeconds: 0 }
  const end = hi ?? { charOffset: textLength, timeSeconds: duration }
  const span = end.charOffset - start.charOffset
  if (span <= 0) return start.timeSeconds
  const t = (charAnchor - start.charOffset) / span
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  return start.timeSeconds + clamped * (end.timeSeconds - start.timeSeconds)
}
