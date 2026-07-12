/** A striking image dominates; minimal caption text. */
import type { LayoutProps } from './types'

export default function ImageHeavyLayout({
  slide,
  colors,
  editable,
  slot,
}: LayoutProps) {
  return (
    <div className="flex h-full flex-col gap-[1.5cqi] p-[4cqi]">
      <div className="flex-1 overflow-hidden rounded-lg">{slot('image')}</div>
      {(slide.caption || editable) && (
        <p className="text-center text-[2cqi]" style={{ color: colors.muted }}>
          {slot('caption')}
        </p>
      )}
    </div>
  )
}
