/**
 * The layout-renderer contract (TMPL-2/TMPL-4): every layout type —
 * built-in today, user-authored later — is one React component with
 * this exact prop shape. Arrangement (HTML/Tailwind) is the renderer's
 * whole job; WHAT a slot contains and HOW it edits comes through the
 * `slot` callback (the slot system), and colors come resolved from the
 * template's theme. Register renderers in ./index.tsx.
 */
import type { ReactNode } from 'react'
import type { Layout, Slide } from '@slide-machine/shared'
import type { ThemeColors, ThemeMetrics, ThemeTextStyles } from '../theme'

export interface LayoutProps {
  slide: Slide
  colors: ThemeColors
  /** The template's named text styles, resolved. A box names one and the
   * renderer reads it here, so restyling "body" restyles every body box. */
  textStyles: ThemeTextStyles
  /** The template's safe area, so a layout that sets no padding of its own
   * still keeps its contents inside the margins the template asks for. */
  metrics: ThemeMetrics
  /** The layout's own definition. The arrangement engine reads its
   * `elementPositions`; hand-tuned components have no use for it. Absent when
   * the template does not declare this layout type. */
  layout?: Layout
  /** True when the viewer may edit: layouts must then render even
   * their EMPTY conditional slots (as clickable placeholders) so a
   * layout switch never strands content the user can't reach. */
  editable?: boolean
  /** True while background enrichment may still deliver an image (GEN-5). An
   * empty image slot must stay on the slide while one is coming, or its
   * loading skeleton has nowhere to appear. */
  imagePending?: boolean
  /** Renders a named content slot (editable when the viewer may edit). The
   * name is a conventional slot, or one a template author defined (TMPL-4). */
  slot: (name: string) => ReactNode
}
