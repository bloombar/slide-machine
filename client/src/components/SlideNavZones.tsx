/**
 * Hover navigation zones over a slide (PLAY-1): each half of the slide
 * is a click hotspot; hovering reveals a previous/next chevron rendered
 * OUTSIDE the slide's edge so slide content is never covered. Zones
 * render only when a slide exists in that direction; arrow keys remain
 * the keyboard path (useArrowKeys).
 */
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  children: ReactNode
}

const zoneClass =
  'absolute inset-y-0 w-1/2 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100'

const chevronClass =
  'absolute top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white'

export default function SlideNavZones({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  children,
}: Props) {
  return (
    <div className="relative">
      {children}
      {hasPrev && (
        <button
          aria-label="Previous slide"
          onClick={onPrev}
          className={`${zoneClass} left-0`}
        >
          <ChevronLeft className={`${chevronClass} -left-14`} aria-hidden />
        </button>
      )}
      {hasNext && (
        <button
          aria-label="Next slide"
          onClick={onNext}
          className={`${zoneClass} right-0`}
        >
          <ChevronRight className={`${chevronClass} -right-14`} aria-hidden />
        </button>
      )}
    </div>
  )
}
