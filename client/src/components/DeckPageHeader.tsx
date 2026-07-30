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
import { useTranslation } from 'react-i18next'
import { GripVertical } from 'lucide-react'
import Tooltip from './Tooltip'

interface Props {
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

/**
 * Pointer travel before a press counts as a drag. The whole pill is the
 * drag surface, buttons included, so a press has to stay still to read as
 * a click — past this it becomes a drag and the click is dropped.
 */
const DRAG_THRESHOLD = 4

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

export default function DeckPageHeader({ actions, deckId }: Props) {
  const { t } = useTranslation()
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

  // Where the press began, and whether it has travelled far enough to be
  // a drag rather than a click
  const pressRef = useRef<Point | null>(null)
  const draggedRef = useRef(false)

  // Tears down an in-flight drag's listeners, on drop or on unmount
  const endDragRef = useRef<(() => void) | null>(null)
  useEffect(() => () => endDragRef.current?.(), [])

  /**
   * Starts tracking a press. The move/up listeners go on the window, not
   * the pill: a drag leaves the pill almost immediately, and element
   * handlers would stop firing the moment it does. Pointer capture would
   * also solve that, but it re-targets the click away from the button
   * underneath, so buttons would stop working.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only: a right-click must not drag the toolbar off
    if (e.button !== 0) return
    const rect = pillRect()
    pressRef.current = { x: e.clientX, y: e.clientY }
    draggedRef.current = false
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    const onMove = (ev: PointerEvent) => {
      // press is set above before this listener is added, and cleared only
      // in onUp which also removes the listener, so it holds here
      const press = pressRef.current!
      let box = pillRect()
      if (!draggedRef.current) {
        const travel = Math.hypot(ev.clientX - press.x, ev.clientY - press.y)
        if (travel < DRAG_THRESHOLD) return
        draggedRef.current = true
        box = lift()
        setDragging(true)
      }
      setPos(
        clampToViewport(
          {
            x: ev.clientX - grabOffset.current.x,
            y: ev.clientY - grabOffset.current.y,
          },
          box,
        ),
      )
    }
    const onUp = () => {
      pressRef.current = null
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      endDragRef.current = null
    }
    endDragRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Drops the click that ends a drag, so dragging off a button never fires it. */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current) return
    e.preventDefault()
    e.stopPropagation()
    draggedRef.current = false
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
        data-testid="deck-toolbar"
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        // The whole pill is the drag surface, buttons included, so it is
        // grabbable wherever the pointer lands. touch-none: a touch drag
        // must move the pill, not scroll the page.
        className={`pointer-events-auto flex touch-none cursor-grab items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur select-none active:cursor-grabbing ${
          pos ? 'fixed z-30' : ''
        }`}
      >
        <Tooltip label={t('deck.toolbar.drag')}>
          <button
            aria-label={t('deck.toolbar.dragHint')}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
            onKeyDown={onKeyDown}
            // The smallest thing on the pill: a handle, not a control
            className="rounded-md p-1 text-slate-300 hover:text-slate-500"
          >
            <GripVertical className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    </header>
  )
}
