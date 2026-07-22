/**
 * Pure helpers for whiteboard stroke timing (WB-2). A stroke's timing is a
 * character offset into the slide's `sourceTranscript` (`StrokeAnchor.charAnchor`);
 * these turn that offset into a proportional position and rescale it when the
 * transcript is rewritten by refinement. Shared by the server refine pass and
 * the client playback overlay so both agree on the math.
 */
import type { Stroke } from '../types/deck'

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
