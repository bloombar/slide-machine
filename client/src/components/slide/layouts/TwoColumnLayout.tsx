/** Text beside a supporting image. */
import type { LayoutProps } from './types'

export default function TwoColumnLayout({ colors, slot }: LayoutProps) {
  return (
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
      <div className="h-3/4 overflow-hidden rounded-lg">{slot('image')}</div>
    </div>
  )
}
