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
import type {
  ImageSearchCandidate,
  Slide,
  Template,
} from '@slide-machine/shared'
import SlideSlot, { type SlideContentPatch } from './slide/slots'
import { themeColors, themeMetrics, themeTextStyles } from './slide/theme'
import { rendererFor } from './slide/layouts'

export type { SlideContentPatch }

export default function SlideView({
  slide,
  template,
  imagePending,
  asTemplate,
  editable,
  onEdit,
  onReplaceImage,
  onPickImageCandidate,
  onRemoveImage,
  testId = 'slide',
}: {
  slide: Slide
  template: Template
  /** Overridden by the template library, whose miniature previews are not
   * slides of a lecture and must not be counted as such. */
  testId?: string
  /** True while background enrichment may still deliver an image (GEN-5). */
  imagePending?: boolean
  /** Shown as a TEMPLATE rather than as a lecture, so an unfilled picture box
   * says it is there instead of drawing nothing (`slots.tsx`). */
  asTemplate?: boolean
  /** Owner-only: enables click-to-edit on every editable slot. */
  editable?: boolean
  onEdit?: (patch: SlideContentPatch) => void
  /** Owner-only image editing (EDIT-1), bound to this slide. The slot name
   * comes along, since a layout may have several image slots (TMPL-4). */
  onReplaceImage?: (file: File, slot: string) => void
  onPickImageCandidate?: (candidate: ImageSearchCandidate, slot: string) => void
  onRemoveImage?: (slot: string) => void
}) {
  const colors = themeColors(template.theme)
  const textStyles = themeTextStyles(template.theme)
  const metrics = themeMetrics(template.theme)
  const layoutDef = template.layouts.find(l => l.type === slide.layoutType)

  /** A named content slot, editable when the owner is viewing. The
   * template's own slot spec (kind/label/validation) takes precedence
   * over the conventional defaults. */
  const slot = (name: string) => (
    <SlideSlot
      slot={name}
      asTemplate={asTemplate}
      spec={layoutDef?.slots.find(s => s.name === name)}
      slide={slide}
      colors={colors}
      onEdit={editable ? onEdit : undefined}
      onReplaceImage={editable ? onReplaceImage : undefined}
      onPickImageCandidate={editable ? onPickImageCandidate : undefined}
      onRemoveImage={editable ? onRemoveImage : undefined}
      imagePending={imagePending}
    />
  )

  return (
    <div
      data-testid={testId}
      data-slide-id={slide.id}
      data-layout={slide.layoutType}
      className="@container aspect-video w-full overflow-hidden rounded-xl shadow-2xl"
      style={
        {
          backgroundColor: colors.background,
          color: colors.text,
          // The link colour, as a custom property rather than a prop: an
          // anchor is drawn deep inside `SlideMarkdown`, in any slot of any
          // layout, and threading a colour through every one of those to
          // reach it would be a lot of plumbing for one rule.
          '--slide-link': colors.link,
        } as React.CSSProperties
      }
    >
      {createElement(rendererFor(slide.layoutType, layoutDef), {
        slide,
        colors,
        textStyles,
        metrics,
        layout: layoutDef,
        editable: Boolean(editable && onEdit),
        imagePending,
        slot,
      })}
    </div>
  )
}
