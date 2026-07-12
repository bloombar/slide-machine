/**
 * Renders one slide in its template theme (GEN-3 / TMPL-2). The
 * arrangement for each layout type comes from the layout-renderer
 * registry (slide/layouts) — adding a layout type never touches this
 * file — and what each slot contains / how it edits comes from the
 * slot system (slide/slots). SlideView itself is just the themed
 * container-query frame wiring the two together.
 *
 * With `editable` + `onEdit`, every slot with an editor becomes
 * editable in place (EDIT-1), auto-saving via the debounced pattern.
 */
import { createElement } from 'react'
import type { LayoutSlot, Slide, Template } from '@slide-machine/shared'
import SlideSlot, { type SlideContentPatch } from './slide/slots'
import { themeColors } from './slide/theme'
import { getLayoutRenderer } from './slide/layouts'

export type { SlideContentPatch }

export default function SlideView({
  slide,
  template,
  imagePending,
  editable,
  onEdit,
}: {
  slide: Slide
  template: Template
  /** True while background enrichment may still deliver an image (GEN-5). */
  imagePending?: boolean
  /** Owner-only: enables click-to-edit on every editable slot. */
  editable?: boolean
  onEdit?: (patch: SlideContentPatch) => void
}) {
  const colors = themeColors(template.theme)
  const layoutDef = template.layouts.find(l => l.type === slide.layoutType)

  /** A named content slot, editable when the owner is viewing. The
   * template's own slot spec (kind/label/validation) takes precedence
   * over the conventional defaults. */
  const slot = (name: LayoutSlot) => (
    <SlideSlot
      slot={name}
      spec={layoutDef?.slots.find(s => s.name === name)}
      slide={slide}
      colors={colors}
      onEdit={editable ? onEdit : undefined}
      imagePending={imagePending}
    />
  )

  return (
    <div
      data-testid="slide"
      data-layout={slide.layoutType}
      className="@container aspect-video w-full overflow-hidden rounded-xl shadow-2xl"
      style={{ backgroundColor: colors.background, color: colors.text }}
    >
      {createElement(getLayoutRenderer(slide.layoutType), {
        slide,
        colors,
        slot,
      })}
    </div>
  )
}
