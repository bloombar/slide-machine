/** A new section or subtopic heading within the lecture. */
import type { LayoutProps } from './types'

export default function SectionLayout({ colors, slot }: LayoutProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[1.5cqi] text-center">
      <div
        className="h-[0.4cqi] w-[8cqi] rounded"
        style={{ backgroundColor: colors.accent }}
      />
      <h2 className="text-[5.5cqi] font-semibold">{slot('title')}</h2>
    </div>
  )
}
