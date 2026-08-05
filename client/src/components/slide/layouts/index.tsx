/**
 * The layout-renderer registry (TMPL-2/TMPL-4): layout types map to
 * arrangement components. Adding a layout type — a new built-in now, a
 * user-authored one later — means one component implementing
 * LayoutProps plus one entry here; SlideView and the generation
 * pipeline never change. Unknown types render through GenericLayout so
 * newer content degrades instead of disappearing.
 */
import type { ComponentType } from 'react'
import type { Layout, TemplateRenderMode } from '@slide-machine/shared'
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
 * The renderer for a layout, chosen by the template's declared `renderMode`.
 *
 * Deliberately not "does this layout have geometry": the exporters read the
 * same `elementPositions`, so a built-in could be given boxes purely to
 * export accurately, and inferring from their presence would silently
 * redesign it on screen. The template says which renderer it wants.
 *
 * A positioned template whose layout has no boxes yet is the one exception:
 * the engine would draw an empty slide, so that layout keeps its hand-tuned
 * component until it is arranged.
 */
export const rendererFor = (
  layoutType: string,
  renderMode?: TemplateRenderMode,
  layout?: Layout,
): ComponentType<LayoutProps> =>
  renderMode === 'positioned' &&
  Object.keys(layout?.elementPositions ?? {}).length > 0
    ? PositionedLayout
    : getLayoutRenderer(layoutType)
