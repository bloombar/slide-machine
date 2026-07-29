/**
 * Shared helpers for rendering a slide's freehand whiteboard marks (WB-1) into
 * exports (PDF, Google Slides). Stroke points are normalized 0..1 to the slide
 * box and `thickness` is normalized to slide width, so a stroke maps onto any
 * target rectangle by simple scaling — the same math the on-screen canvas uses.
 */
import type { Stroke } from '@slide-machine/shared'

/** Highlighter opacity, matching the editor (client useWhiteboard). Pen is opaque. */
export const HIGHLIGHTER_ALPHA = 0.4

/**
 * The marks that should appear in a static export: everything that was drawn
 * and not erased, and not orphaned by a transcript refine (WB-2). Erased and
 * orphaned strokes are kept in storage but hidden, so exports match the editor.
 */
export const visibleStrokes = (drawings?: Stroke[]): Stroke[] =>
  (drawings ?? []).filter(s => !s.erasedAnchor && !s.anchor?.orphaned)

/** Parses a #rgb/#rrggbb hex color to 0..1 components (pdf-lib's rgb space);
 * falls back to black for anything unparseable. */
export const hexToRgb01 = (
  hex: string,
): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  let h = m[1]!
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  const n = parseInt(h, 16)
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  }
}

/** Normalizes a stroke color to a 6-digit uppercase hex (no leading #), the
 * form pptxgenjs expects; falls back to black. */
export const hexForPptx = (hex: string): string => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '000000'
  const h = m[1]!
  const full =
    h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h
  return full.toUpperCase()
}
