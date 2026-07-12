/**
 * The layout-renderer contract (TMPL-2/TMPL-4): every layout type —
 * built-in today, user-authored later — is one React component with
 * this exact prop shape. Arrangement (HTML/Tailwind) is the renderer's
 * whole job; WHAT a slot contains and HOW it edits comes through the
 * `slot` callback (the slot system), and colors come resolved from the
 * template's theme. Register renderers in ./index.tsx.
 */
import type { ReactNode } from 'react'
import type { LayoutSlot, Slide } from '@slide-machine/shared'
import type { ThemeColors } from '../theme'

export interface LayoutProps {
  slide: Slide
  colors: ThemeColors
  /** True when the viewer may edit: layouts must then render even
   * their EMPTY conditional slots (as clickable placeholders) so a
   * layout switch never strands content the user can't reach. */
  editable?: boolean
  /** Renders a named content slot (editable when the viewer may edit). */
  slot: (name: LayoutSlot) => ReactNode
}
