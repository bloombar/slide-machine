/**
 * Pointer navigation for a slide in carousel mode (PLAY-1). A previous/next
 * chevron is revealed based on where the cursor sits relative to the
 * slide's horizontal midpoint — left of centre reveals previous, right of
 * centre reveals next — and each chevron is rendered OUTSIDE the slide's
 * edge so slide content is never covered.
 *
 * Why track the pointer instead of hovering superimposed hotspots: slide
 * content (images, editable text) is lifted above the slide with z-index so
 * its own hover/click affordances work, which means a hotspot overlay would
 * sit UNDER that content and never receive the hover. A mousemove listener
 * on the container sidesteps stacking entirely — the event bubbles up from
 * whatever child is under the cursor — so the chevrons reveal over images
 * and text alike. Arrow keys remain the keyboard path (useArrowKeys); the
 * chevrons also reveal on keyboard focus.
 */
import { useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  children: ReactNode
}

/** Which chevron the cursor position currently reveals, if any. */
type Side = 'prev' | 'next' | null

// A full-height strip flush against the slide's edge (right-full / left-full
// sit it just outside), so moving the cursor from the slide onto the chevron
// never crosses a dead gap that would hide it mid-reach. Transparent but for
// the centred chevron; only clickable while it is the revealed side.
const zoneClass =
  'absolute inset-y-0 flex w-14 items-center justify-center transition-opacity duration-150 focus-visible:opacity-100'

const chevronClass = 'h-10 w-10 rounded-full bg-black/40 p-2 text-white'

export default function SlideNavZones({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  children,
}: Props) {
  const [side, setSide] = useState<Side>(null)

  // Reveal the chevron for whichever half the cursor is over. setState bails
  // out when the side is unchanged, so this only re-renders on a crossing.
  const trackSide = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setSide(e.clientX < rect.left + rect.width / 2 ? 'prev' : 'next')
  }

  return (
    <div
      className="relative"
      onMouseMove={trackSide}
      onMouseLeave={() => setSide(null)}
    >
      {children}
      {hasPrev && (
        <button
          aria-label="Previous slide"
          onClick={onPrev}
          className={`${zoneClass} right-full ${
            side === 'prev' ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <ChevronLeft className={chevronClass} aria-hidden />
        </button>
      )}
      {hasNext && (
        <button
          aria-label="Next slide"
          onClick={onNext}
          className={`${zoneClass} left-full ${
            side === 'next' ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <ChevronRight className={chevronClass} aria-hidden />
        </button>
      )}
    </div>
  )
}
