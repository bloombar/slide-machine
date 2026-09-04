/**
 * Floating toolbar for the deck viewer: carousel/list toggle and
 * page-specific actions grouped into one pill. The pill starts pinned
 * below the primary nav while slides scroll beneath it; dragging its grip
 * lifts it out and parks it anywhere in the window. Where it was left is
 * remembered per lecture, so a reload restores it and a brand-new lecture
 * starts pinned. The lecture title itself lives in the primary nav (via
 * ShellTitle), not here.
 *
 * Full-screen slide viewing (PLAY-5) keeps a SECOND remembered position,
 * entirely independent of the regular one: dragging the pill full screen
 * moves and remembers only where it sits full screen, leaving mode never
 * touches it, and re-entering returns it there. The two are different
 * places for a reason — full screen has no page chrome to avoid and a
 * different natural home (`fixed top-16 start-2`, see the render below) —
 * so a position that made sense in one would routinely be wrong in the
 * other. See docs/DECISIONS.md.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical } from 'lucide-react'
import Tooltip from './Tooltip'
import { beginDrag, endDrag } from '../hooks/dragGuard'

interface Props {
  actions?: ReactNode
  /** Scopes the remembered position; a lecture with no entry starts pinned. */
  deckId: string
  /**
   * Full-screen slide viewing is active (PLAY-5): the pill has to stay
   * reachable over the full-screen overlay, which paints at the primary
   * nav's own z-50, and it tracks its OWN remembered position while this
   * is true — see the module docstring and the z-index tiers in
   * docs/DECISIONS.md.
   */
  fullScreen?: boolean
  /**
   * Rendered inside this same header, at its right edge, vertically
   * centred on the pill's default (parked) row (PLAY-5 — the full-screen
   * Maximize button). Positioned independently of the pill via an
   * absolutely-placed wrapper, so it never joins the drag surface and
   * never shifts the pill's own centring.
   */
  trailing?: ReactNode
}

/** Page-chrome tier (z-30, docs/DECISIONS.md) normally; while full screen is
 * active this pill has to beat the full-screen overlay (z-50) too, so it
 * moves to the tier just above it — still under modals (z-60). */
const zTier = (fullScreen: boolean | undefined): string =>
  fullScreen ? 'z-[55]' : 'z-30'

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
 * Full-screen positions live under a distinct key, not a field alongside
 * the regular one — an existing stored regular position (from before
 * PLAY-5) must go on meaning exactly what it always did, and a distinct
 * key is the simplest way to guarantee that. `readStored`/`writeStored`
 * work off whichever key they are handed.
 */
const fullScreenKey = (deckId: string): string => `${deckId}:fs`

/**
 * Reads a lecture's remembered pill position for one mode's key. Returns
 * null when nothing is stored, or when the entry is unusable — storage is
 * shared with other tabs and survives deploys, so it is never trusted
 * blindly.
 */
const readStored = (key: string): Point | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
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

/** Remembers a position under one mode's key, or forgets it when that
 * mode's pill parks again. */
const writeStored = (key: string, point: Point | null): void => {
  try {
    if (point) {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(point))
    } else {
      localStorage.removeItem(STORAGE_PREFIX + key)
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
  actions,
  deckId,
  fullScreen,
  trailing,
}: Props) {
  const { t } = useTranslation()
  const pillRef = useRef<HTMLDivElement>(null)
  // Two independent remembered positions (PLAY-5): null while parked in
  // that mode's own default spot, a point once dragged in that mode.
  const [pos, setPos] = useState<Point | null>(() => readStored(deckId))
  const [fsPos, setFsPos] = useState<Point | null>(() =>
    readStored(fullScreenKey(deckId)),
  )
  // Whichever mode is showing right now — every read and every drag acts
  // on this pair, never on the other mode's.
  const current = fullScreen ? fsPos : pos
  const setCurrent = fullScreen ? setFsPos : setPos
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
   *
   * `setCurrent` is read once, at the moment the press starts, and used
   * for the whole gesture — full screen cannot toggle mid-drag, so this
   * is simply "whichever mode's state this drag belongs to".
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only: a right-click must not drag the toolbar off
    if (e.button !== 0) return
    const rect = pillRect()
    const setThisMode = setCurrent
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
        // Blocks the full-screen shortcuts for the rest of this gesture
        // (dragGuard.ts) — a mid-drag mode toggle would otherwise teleport
        // this pill to the OTHER mode's spot without releasing the
        // pointer, corrupting the mode the drag actually started in.
        beginDrag()
      }
      setThisMode(
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
      if (draggedRef.current) endDrag()
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

  /** Keyboard parity: arrows nudge the pill, Escape parks it again — both
   * acting on whichever mode is currently showing. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      // Full screen (PLAY-5) also binds Escape, on window in the bubble
      // phase (useFullScreenKeys) — the same phase this handler's native
      // event is still on its way through. Left alone, parking a dragged
      // pill would keep bubbling past this button and exit full screen in
      // the same keystroke. Stopping it here keeps Escape scoped to
      // whichever the pill's own action actually was.
      e.stopPropagation()
      setCurrent(null)
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
    setCurrent(prior =>
      clampToViewport(
        {
          x: (prior?.x ?? rect.left) + delta.x,
          y: (prior?.y ?? rect.top) + delta.y,
        },
        rect,
      ),
    )
  }

  /**
   * Measures the pill as it attaches, and re-fits whichever mode's
   * position is current to the window it actually attached in. `fullScreen`
   * sits in the dependency array so this fires again on every full-screen
   * toggle, not only on mount: React detaches and reattaches a callback
   * ref whenever its identity changes, calling it with the (unchanged) DOM
   * node again exactly as if it had just mounted. That is what lets
   * entering full screen re-fit the full-screen position (and leaving
   * re-fit the regular one) without an Effect setting state in its own
   * body — the shape React's own linter flags as cascading renders.
   */
  const attachPill = useCallback(
    (el: HTMLDivElement | null) => {
      pillRef.current = el
      if (!el) return
      const rect = el.getBoundingClientRect()
      setReserved(rect.height)
      if (fullScreen) {
        setFsPos(prior => (prior ? clampToViewport(prior, rect) : null))
      } else {
        setPos(prior => (prior ? clampToViewport(prior, rect) : null))
      }
    },
    [fullScreen],
  )

  // Remember where the pill was left in each mode, but not mid-drag:
  // waiting for the gesture to finish keeps this to one write per move
  // instead of one per frame. Parking (null) clears that mode's entry, so
  // the lecture reverts to that mode's own pinned default. The two modes
  // are stored under different keys and so never overwrite each other.
  useEffect(() => {
    if (dragging) return
    writeStored(deckId, pos)
  }, [deckId, pos, dragging])
  useEffect(() => {
    if (dragging) return
    writeStored(fullScreenKey(deckId), fsPos)
  }, [deckId, fsPos, dragging])

  // A shrinking window must not strand the pill off-screen, in whichever
  // mode is showing.
  const floating = current !== null
  useEffect(() => {
    if (!floating) return
    const onResize = () => {
      const rect = pillRef.current!.getBoundingClientRect()
      // Only runs while floating, so the position is set by definition
      setCurrent(prior => clampToViewport(prior!, rect))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [floating, setCurrent])

  return (
    // Parked, regular view: sticky keeps the row in flow, so the first slide
    // never starts underneath the pill, and top-16 clears the h-14 nav.
    // Parked, full screen (PLAY-5): sticky is document-flow positioning, and
    // the full-screen overlay covers the viewport regardless of where the
    // document happens to be scrolled — so the pill goes `fixed` at a fixed
    // viewport spot (top-left, under the margin it already keeps clear of
    // the nav) instead of wherever sticky would have parked it. Floating
    // (dragged, in either mode): the row stays behind as a fixed-height
    // spacer either way — the dragged pill is already `fixed` and
    // unaffected by scrolling.
    // z-30 is the page-chrome tier (docs/DECISIONS.md); full screen raises
    // it to z-[55], above the overlay's z-50. The row spans the full width
    // but only the pill is interactive, so slides behind it stay clickable.
    <header
      className={`pointer-events-none mb-4 flex ${
        floating
          ? // No sticky/fixed here — the pill positions itself once dragged
            // — but `trailing` still needs a containing block to sit in the
            // header's own band, hence `relative` rather than the empty
            // string this branch used before PLAY-5's `trailing` prop.
            'relative'
          : fullScreen
            ? `fixed top-16 start-2 ${zTier(fullScreen)}`
            : `sticky top-16 justify-center ${zTier(fullScreen)}`
      }`}
      style={floating ? { height: reserved } : undefined}
    >
      <div
        ref={attachPill}
        data-testid="deck-toolbar"
        // A real data attribute for other production code to anchor on
        // (PLAY-5's WhiteboardToolbar measures this pill) — `data-testid`
        // is reserved for tests: a rename or a stripping transform there
        // would silently drop production's own anchor to a fallback perch.
        data-deck-toolbar-pill
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        style={current ? { left: current.x, top: current.y } : undefined}
        // The whole pill is the drag surface, buttons included, so it is
        // grabbable wherever the pointer lands. touch-none: a touch drag
        // must move the pill, not scroll the page.
        className={`pointer-events-auto flex touch-none cursor-grab items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur select-none active:cursor-grabbing ${
          current ? `fixed ${zTier(fullScreen)}` : ''
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
      {/* PLAY-5: the full-screen Maximize button, held at this header's own
          right edge and vertically centred on its band via an absolutely
          positioned wrapper — independent of the pill's own flex centring,
          so it neither joins the pill's drag surface nor shifts the pill.
          `sticky`/`fixed`/`relative` on the header above all establish the
          containing block this needs, in every one of the three states. */}
      {trailing && (
        <div className="pointer-events-auto absolute inset-y-0 end-0 flex items-center">
          {trailing}
        </div>
      )}
    </header>
  )
}
