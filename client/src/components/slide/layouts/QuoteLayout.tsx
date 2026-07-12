/** A single striking statement, question, or quotation. */
import type { LayoutProps } from './types'

export default function QuoteLayout({ slide, colors, slot }: LayoutProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[2cqi] px-[8cqi] text-center">
      <div className="text-[4cqi] font-medium italic">“{slot('body')}”</div>
      {slide.caption && (
        <p style={{ color: colors.muted }}>{slot('caption')}</p>
      )}
    </div>
  )
}
