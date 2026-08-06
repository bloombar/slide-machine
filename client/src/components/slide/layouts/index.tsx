/**
 * The layout-renderer registry (TMPL-2/TMPL-4).
 *
 * There used to be a component per layout type — a title layout, a two-column
 * layout, and so on. Those are gone: every layout is now described as data (a
 * tree of containers and boxes) and drawn by FlowLayout, so a layout an
 * instructor builds in the editor and one the app ships are the same kind of
 * thing.
 *
 * Two renderers remain beside it, and both are fallbacks rather than
 * alternatives:
 *   PositionedLayout — geometry with no tree, which is what a design imported
 *                      from Google Slides is (TMPL-8)
 *   GenericLayout    — neither, so nothing is known about the design. Stacks
 *                      whatever the slide holds: degraded, never blank.
 */
import type { ComponentType } from 'react'
import type { Layout } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import type { LayoutProps } from './types'
import FlowLayout from './FlowLayout'
import GenericLayout from './GenericLayout'
import PositionedLayout from './PositionedLayout'
import WhiteboardLayout from './WhiteboardLayout'

export type { LayoutProps } from './types'

/**
 * The renderer for a layout, in order of how much the layout says about
 * itself: its tree, then its geometry, then nothing.
 *
 * The whiteboard is checked first and never falls through. It is a blank
 * slate by definition (WB-1) — no slots, nothing to arrange — and the generic
 * fallback would offer an editor for content it must never hold.
 *
 * `renderMode` is not consulted. It was there to keep "has geometry" from
 * meaning "draw from geometry", back when giving a built-in boxes purely to
 * improve its PDF would have redesigned it on screen. Layouts now carry a
 * tree and geometry is derived from it, so the ambiguity is gone
 * (docs/TEMPLATES.md §4).
 */
export const rendererFor = (
  layoutType: string,
  layout?: Layout,
): ComponentType<LayoutProps> => {
  if (layoutType === WHITEBOARD_LAYOUT_TYPE) return WhiteboardLayout
  if (layout?.tree) return FlowLayout
  if (Object.keys(layout?.elementPositions ?? {}).length > 0)
    return PositionedLayout
  return GenericLayout
}
