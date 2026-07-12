/**
 * Forward-compatibility fallback: renders a layout type this client
 * has no registered renderer for (e.g. a newer server or, later, a
 * user-authored layout not yet supported here). Stacks whichever slots
 * the slide actually populates — degraded but never blank.
 */
import type { LayoutProps } from './types'

export default function GenericLayout({
  slide,
  colors,
  editable,
  slot,
}: LayoutProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-[2cqi] px-[6cqi]">
      {(slide.title !== undefined || editable) && (
        <h2
          className="text-[4cqi] font-semibold"
          style={{ color: colors.accent }}
        >
          {slot('title')}
        </h2>
      )}
      {(slide.body !== undefined || editable) && (
        <div className="text-[2.75cqi] leading-relaxed">{slot('body')}</div>
      )}
      {slide.bullets !== undefined && slot('bullets')}
      {slide.imageRef !== undefined && (
        <div className="max-h-[40cqi] overflow-hidden rounded-lg">
          {slot('image')}
        </div>
      )}
      {(slide.caption !== undefined || editable) && (
        <p className="text-[2cqi]" style={{ color: colors.muted }}>
          {slot('caption')}
        </p>
      )}
    </div>
  )
}
