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
 *
 * Swipe (PLAY-1): a horizontal drag/flick moves to the previous/next slide on
 * touch (mobile) and mouse/trackpad (desktop) alike, via Pointer Events. The
 * container sets `touch-action: pan-y`, so the browser still owns vertical
 * scrolling (and its own edge back-swipe is suppressed) while horizontal
 * gestures come through to us. Taps, vertical scrolls, drawing, and control
 * presses all fall through untouched (see `onPointerDown`/`onPointerUp`).
 */
import {
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
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

// Minimum horizontal travel (px) for a drag to count as a slide-changing
// swipe; shorter movements are taps or jitter and are ignored.
const SWIPE_THRESHOLD = 50

// Controls and surfaces that own their own pointer gestures — a swipe must
// never start on these. The drawing canvas sits on top while a whiteboard
// tool is active, so a gesture over it is a drawing gesture, not a swipe.
const NO_SWIPE_SELECTOR =
  'button, a, input, textarea, select, [data-testid="drawing-layer"]'

export default function SlideNavZones({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  children,
}: Props) {
  const { t } = useTranslation()
  const [side, setSide] = useState<Side>(null)
  // Where a candidate swipe began; null when no gesture is being tracked.
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null)

  // Reveal the chevron for whichever half the cursor is over. setState bails
  // out when the side is unchanged, so this only re-renders on a crossing.
  const trackSide = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setSide(e.clientX < rect.left + rect.width / 2 ? 'prev' : 'next')
  }

  // Begin tracking a swipe — unless the gesture starts on a control (or the
  // active drawing canvas), which keeps their own taps/drags working.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as Element | null
    if (target?.closest(NO_SWIPE_SELECTOR)) {
      swipeStart.current = null
      return
    }
    swipeStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }

  // On release, a horizontal-dominant drag past the threshold steps a slide.
  // Taps (little travel) and vertical scrolls (|dy| ≥ |dx|) fall through, and
  // a drag that was really a text selection is ignored.
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || start.id !== e.pointerId) return
    if (!window.getSelection?.()?.isCollapsed) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return
    if (dx < 0) {
      if (hasNext) onNext()
    } else if (hasPrev) {
      onPrev()
    }
  }

  return (
    <div
      className="relative touch-pan-y"
      onMouseMove={trackSide}
      onMouseLeave={() => setSide(null)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipeStart.current = null
      }}
    >
      {children}
      {hasPrev && (
        <button
          aria-label={t('slide.previous')}
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
          aria-label={t('slide.next')}
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
