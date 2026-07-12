/** Opening slide: the lecture or major-topic title, nothing else. */
import type { LayoutProps } from './types'

export default function TitleLayout({ slide, colors, slot }: LayoutProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2cqi] text-center">
      <h1 className="text-[7cqi] font-bold">{slot('title')}</h1>
      {slide.caption && (
        <p style={{ color: colors.muted }}>{slot('caption')}</p>
      )}
    </div>
  )
}
