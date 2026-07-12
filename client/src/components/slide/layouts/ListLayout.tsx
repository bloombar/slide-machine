/** A titled bullet list for 3-6 short parallel points. */
import type { LayoutProps } from './types'

export default function ListLayout({ colors, slot }: LayoutProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-[3cqi] px-[6cqi]">
      <h2
        className="text-[4cqi] font-semibold"
        style={{ color: colors.accent }}
      >
        {slot('title')}
      </h2>
      {slot('bullets')}
    </div>
  )
}
