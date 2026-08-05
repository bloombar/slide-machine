/**
 * The layout-renderer registry (TMPL-2/TMPL-4): layout types map to
 * arrangement components. Adding a layout type — a new built-in now, a
 * user-authored one later — means one component implementing
 * LayoutProps plus one entry here; SlideView and the generation
 * pipeline never change. Unknown types render through GenericLayout so
 * newer content degrades instead of disappearing.
 */
import type { ComponentType } from 'react'
import type { Layout } from '@slide-machine/shared'
import type { LayoutProps } from './types'
import TitleLayout from './TitleLayout'
import SectionLayout from './SectionLayout'
import ContentLayout from './ContentLayout'
import ListLayout from './ListLayout'
import ImageHeavyLayout from './ImageHeavyLayout'
import TwoColumnLayout from './TwoColumnLayout'
import QuoteLayout from './QuoteLayout'
import WhiteboardLayout from './WhiteboardLayout'
import GenericLayout from './GenericLayout'
import PositionedLayout from './PositionedLayout'

export type { LayoutProps } from './types'

const LAYOUT_RENDERERS: Record<string, ComponentType<LayoutProps>> = {
  title: TitleLayout,
  section: SectionLayout,
  content: ContentLayout,
  list: ListLayout,
  'image-heavy': ImageHeavyLayout,
  'two-column': TwoColumnLayout,
  quote: QuoteLayout,
  whiteboard: WhiteboardLayout,
}

/** The renderer for a layout type; unknown types get the fallback. */
export const getLayoutRenderer = (
  layoutType: string,
): ComponentType<LayoutProps> => LAYOUT_RENDERERS[layoutType] ?? GenericLayout

/**
 * The renderer for a layout: its own arrangement data if it has any, else the
 * hand-tuned component for its type. This is the seam that lets a layout move
 * from code to data one at a time — a template that positions its slots is
 * drawn by the engine, and everything else is untouched.
 */
export const rendererFor = (
  layoutType: string,
  layout?: Layout,
): ComponentType<LayoutProps> =>
  layout && Object.keys(layout.elementPositions ?? {}).length > 0
    ? PositionedLayout
    : getLayoutRenderer(layoutType)
