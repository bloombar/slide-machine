/**
 * Floating toolbar for the deck viewer: carousel/list toggle and
 * page-specific actions grouped into one pill. The pill starts pinned
 * below the primary nav while slides scroll beneath it; dragging its grip
 * lifts it out and parks it anywhere in the window. Where it was left is
 * remembered per lecture, so a reload restores it and a brand-new lecture
 * starts pinned. The lecture title itself lives in the primary nav (via
 * ShellTitle), not here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import ViewModeToggle, { type ViewMode } from './ViewModeToggle'

interface Props {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  actions?: ReactNode
  /** Scopes the remembered position; a lecture with no entry starts pinned. */
  deckId: string
}

/** Viewport coordinates of the pill's top-left corner. */
interface Point {
  x: number
  y: number
}

/** Breathing room kept between the pill and every window edge. */
const MARGIN = 8

/**
 * Bands owned by the sticky page chrome: the primary nav (h-14, AppShell)
 * and the health footer (h-8, HealthFooter). Both paint over the pill —
 * the nav sits at z-50, and the footer shares the pill's z-30 but renders
 * after it — so a pill dropped in either band would vanish behind it and
 * be unreachable, including on the next reload. The drag area stops short
 * of both.
 */
const NAV_HEIGHT = 56
const FOOTER_HEIGHT = 32

/** Pixels an arrow key moves the pill — the keyboard path for dragging. */
const NUDGE = 16

const STORAGE_PREFIX = 'sm:deck-toolbar:'

/**
 * Reads a lecture's remembered pill position. Returns null when nothing
 * is stored, or when the entry is unusable — storage is shared with other
 * tabs and survives deploys, so it is never trusted blindly.
 */
const readStored = (deckId: string): Point | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + deckId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const point = parsed as Partial<Point>
    return typeof point?.x === 'number' && typeof point?.y === 'number'
      ? { x: point.x, y: point.y }
      : null
  } catch {
    return null
  }
}

/** Remembers a position, or forgets it when the pill parks again. */
const writeStored = (deckId: string, point: Point | null): void => {
  try {
    if (point) {
      localStorage.setItem(STORAGE_PREFIX + deckId, JSON.stringify(point))
    } else {
      localStorage.removeItem(STORAGE_PREFIX + deckId)
    }
  } catch {
    // Storage can be unavailable (private browsing) — the pill still
    // drags, it just forgets where it was left
  }
}

/**
 * Holds a point inside the reachable area: within the window, and clear of
 * the nav and footer that would paint over it. Collapses to the top of
 * that area when the window is somehow smaller than the pill itself.
 */
const clampToViewport = (point: Point, size: DOMRect): Point => {
  // The nav's lower edge plus a margin — exactly where the pill parks
  const minY = NAV_HEIGHT + MARGIN
  const maxX = Math.max(MARGIN, window.innerWidth - size.width - MARGIN)
  const maxY = Math.max(
    minY,
    window.innerHeight - FOOTER_HEIGHT - size.height - MARGIN,
  )
  return {
    x: Math.min(Math.max(point.x, MARGIN), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  }
}

export default function DeckPageHeader({
  mode,
  onModeChange,
  actions,
  deckId,
}: Props) {
  const pillRef = useRef<HTMLDivElement>(null)
  // null while parked in the default pinned spot; a point once dragged
  const [pos, setPos] = useState<Point | null>(() => readStored(deckId))
  const [dragging, setDragging] = useState(false)
  // The pill's height, held open by the header once the pill floats free,
  // so lifting it out does not jerk the slides upward
  const [reserved, setReserved] = useState(0)
  // Where inside the pill the pointer grabbed, so it does not jump
  const grabOffset = useRef<Point>({ x: 0, y: 0 })

  // The pill is always mounted before any handler here can run — they all
  // hang off the grip, which lives inside the pill — so the ref holds.
  const pillRect = (): DOMRect => pillRef.current!.getBoundingClientRect()

  /** Reserves the pill's row before it lifts out of the layout. */
  const lift = (): DOMRect => {
    const rect = pillRect()
    setReserved(rect.height)
    return rect
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = lift()
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setPos(clampToViewport({ x: rect.left, y: rect.top }, rect))
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return
    setPos(
      clampToViewport(
        {
          x: e.clientX - grabOffset.current.x,
          y: e.clientY - grabOffset.current.y,
        },
        pillRect(),
      ),
    )
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /** Keyboard parity: arrows nudge the pill, Escape parks it again. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      setPos(null)
      return
    }
    const step: Record<string, Point> = {
      ArrowLeft: { x: -NUDGE, y: 0 },
      ArrowRight: { x: NUDGE, y: 0 },
      ArrowUp: { x: 0, y: -NUDGE },
      ArrowDown: { x: 0, y: NUDGE },
    }
    const delta = step[e.key]
    if (!delta) return
    e.preventDefault()
    const rect = lift()
    setPos(current =>
      clampToViewport(
        {
          x: (current?.x ?? rect.left) + delta.x,
          y: (current?.y ?? rect.top) + delta.y,
        },
        rect,
      ),
    )
  }

  /**
   * Measures the pill as it attaches. A remembered position was stored
   * against a window that may no longer exist (smaller screen, different
   * monitor), so it is re-fitted — and its row reserved — here rather
   * than in an effect, which would land after the first paint.
   */
  const attachPill = useCallback((el: HTMLDivElement | null) => {
    pillRef.current = el
    if (!el) return
    const rect = el.getBoundingClientRect()
    setReserved(rect.height)
    setPos(current => (current ? clampToViewport(current, rect) : null))
  }, [])

  // Remember where the pill was left, but not mid-drag: waiting for the
  // gesture to finish keeps this to one write per move instead of one per
  // frame. Parking (pos === null) clears the entry, so the lecture
  // reverts to the pinned default.
  useEffect(() => {
    if (dragging) return
    writeStored(deckId, pos)
  }, [deckId, pos, dragging])

  // A shrinking window must not strand the pill off-screen
  const floating = pos !== null
  useEffect(() => {
    if (!floating) return
    const onResize = () => {
      const rect = pillRef.current!.getBoundingClientRect()
      // Only runs while floating, so the position is set by definition
      setPos(current => clampToViewport(current!, rect))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [floating])

  return (
    // Parked: sticky keeps the row in flow, so the first slide never
    // starts underneath the pill, and top-16 clears the h-14 nav.
    // Floating: the row stays behind as a fixed-height spacer.
    // z-30 is the page-chrome tier (docs/DECISIONS.md) — above slide
    // content, below modals and the nav. The row spans the full width but
    // only the pill is interactive, so slides behind it stay clickable.
    <header
      className={`pointer-events-none mb-4 flex justify-center ${
        floating ? '' : 'sticky top-16 z-30'
      }`}
      style={floating ? { height: reserved } : undefined}
    >
      <div
        ref={attachPill}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={`pointer-events-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur ${
          pos ? 'fixed z-30' : ''
        }`}
      >
        <button
          aria-label="Drag to move the toolbar"
          title="Drag to move · arrow keys nudge · Esc resets"
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          // touch-none: a touch drag must move the pill, not scroll the page
          className={`touch-none rounded-md p-2 text-slate-400 select-none hover:text-slate-600 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <GripVertical className="h-5 w-5" aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <ViewModeToggle mode={mode} onChange={onModeChange} />
        {actions && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <div className="flex items-center gap-1">{actions}</div>
          </>
        )}
      </div>
    </header>
  )
}
