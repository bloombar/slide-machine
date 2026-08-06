/**
 * Shapes the template editor passes around.
 *
 * `ThemeMetricsLike` is the spacing the geometry helpers need, named
 * structurally rather than imported from the slide renderer: the maths does
 * not care where the numbers came from, and stating only what it reads keeps
 * it testable without a theme.
 */
export type { LayoutGuides } from '@slide-machine/shared'

export interface ThemeMetricsLike {
  marginX: number
  marginY: number
  gap: number
}
