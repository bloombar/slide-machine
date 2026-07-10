/**
 * Hover navigation zones over a slide (PLAY-1): the left and right
 * thirds of the slide reveal previous/next chevrons on hover and click
 * to navigate. Zones render only when there is a slide to go to; arrow
 * keys remain the keyboard path (useArrowKeys).
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
  'absolute inset-y-0 flex w-1/3 items-center opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100'

const chevronClass = 'h-10 w-10 rounded-full bg-black/40 p-2 text-white'

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
          className={`${zoneClass} left-0 justify-start rounded-l-xl pl-4`}
        >
          <ChevronLeft className={chevronClass} aria-hidden />
        </button>
      )}
      {hasNext && (
        <button
          aria-label="Next slide"
          onClick={onNext}
          className={`${zoneClass} right-0 justify-end rounded-r-xl pr-4`}
        >
          <ChevronRight className={chevronClass} aria-hidden />
        </button>
      )}
    </div>
  )
}
