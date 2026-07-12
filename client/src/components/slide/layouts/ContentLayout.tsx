/** General slide: a short title plus one paragraph of body text. */
import type { LayoutProps } from './types'

export default function ContentLayout({ colors, slot }: LayoutProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-[3cqi] px-[6cqi]">
      <h2
        className="text-[4cqi] font-semibold"
        style={{ color: colors.accent }}
      >
        {slot('title')}
      </h2>
      <div className="text-[2.75cqi] leading-relaxed">{slot('body')}</div>
    </div>
  )
}
