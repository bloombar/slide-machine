/**
 * Renders one slide in its template theme, arranged by layoutType
 * (GEN-3 / TMPL-2). Layouts only position named content slots; what a
 * slot is (text, bullets, image, ...) and how it is edited comes from
 * the slot system in slide/slots.tsx, so new editable media types plug
 * in without touching the layouts here.
 *
 * With `editable` + `onEdit`, every slot with an editor becomes
 * editable in place (EDIT-1), auto-saving via the debounced pattern.
 */
import type { LayoutSlot, Slide, Template } from '@slide-machine/shared'
import SlideSlot, { type SlideContentPatch } from './slide/slots'
import { themeColors } from './slide/theme'

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

  /** A named content slot, editable when the owner is viewing. */
  const slot = (name: LayoutSlot) => (
    <SlideSlot
      slot={name}
      slide={slide}
      colors={colors}
      onEdit={editable ? onEdit : undefined}
      imagePending={imagePending}
    />
  )

  const body = (
    <>
      {slide.layoutType === 'title' && (
        <div className="flex h-full flex-col items-center justify-center gap-[2cqi] text-center">
          <h1 className="text-[7cqi] font-bold">{slot('title')}</h1>
          {slide.caption && (
            <p style={{ color: colors.muted }}>{slot('caption')}</p>
          )}
        </div>
      )}
      {slide.layoutType === 'section' && (
        <div className="flex h-full flex-col items-center justify-center gap-[1.5cqi] text-center">
          <div
            className="h-[0.4cqi] w-[8cqi] rounded"
            style={{ backgroundColor: colors.accent }}
          />
          <h2 className="text-[5.5cqi] font-semibold">{slot('title')}</h2>
        </div>
      )}
      {slide.layoutType === 'content' && (
        <div className="flex h-full flex-col justify-center gap-[3cqi] px-[6cqi]">
          <h2
            className="text-[4cqi] font-semibold"
            style={{ color: colors.accent }}
          >
            {slot('title')}
          </h2>
          <div className="text-[2.75cqi] leading-relaxed">{slot('body')}</div>
        </div>
      )}
      {slide.layoutType === 'list' && (
        <div className="flex h-full flex-col justify-center gap-[3cqi] px-[6cqi]">
          <h2
            className="text-[4cqi] font-semibold"
            style={{ color: colors.accent }}
          >
            {slot('title')}
          </h2>
          {slot('bullets')}
        </div>
      )}
      {slide.layoutType === 'image-heavy' && (
        <div className="flex h-full flex-col gap-[1.5cqi] p-[4cqi]">
          <div className="flex-1 overflow-hidden rounded-lg">
            {slot('image')}
          </div>
          {slide.caption && (
            <p
              className="text-center text-[2cqi]"
              style={{ color: colors.muted }}
            >
              {slot('caption')}
            </p>
          )}
        </div>
      )}
      {slide.layoutType === 'two-column' && (
        <div className="grid h-full grid-cols-2 items-center gap-[4cqi] px-[6cqi]">
          <div className="flex flex-col gap-[2cqi]">
            <h2
              className="text-[4cqi] font-semibold"
              style={{ color: colors.accent }}
            >
              {slot('title')}
            </h2>
            <div className="text-[2.5cqi] leading-relaxed">{slot('body')}</div>
          </div>
          <div className="h-3/4 overflow-hidden rounded-lg">
            {slot('image')}
          </div>
        </div>
      )}
      {slide.layoutType === 'quote' && (
        <div className="flex h-full flex-col items-center justify-center gap-[2cqi] px-[8cqi] text-center">
          <div className="text-[4cqi] font-medium italic">“{slot('body')}”</div>
          {slide.caption && (
            <p style={{ color: colors.muted }}>{slot('caption')}</p>
          )}
        </div>
      )}
    </>
  )

  return (
    <div
      data-testid="slide"
      data-layout={slide.layoutType}
      className="@container aspect-video w-full overflow-hidden rounded-xl shadow-2xl"
      style={{ backgroundColor: colors.background, color: colors.text }}
    >
      {body}
    </div>
  )
}
