/**
 * Vertical floating toolbar for whiteboard tools (WB-1): pen, highlighter,
 * eraser. A grip at the top repositions it by dragging; it stays fixed while
 * the page scrolls and remembers where it was left per lecture. It starts to
 * the left of the slides, top-aligned. Pressing and holding pen/highlighter
 * expands a color + thickness picker (ColorThicknessPopover).
 *
 * The drag mechanics mirror DeckPageHeader (pointer threshold, window-level
 * move/up, viewport clamping, localStorage persistence), but this pill is
 * always `fixed` and only the grip is the drag surface, so the tool buttons
 * keep their click + press-hold gestures.
 *
 * Full-screen slide viewing (PLAY-5) keeps a SECOND remembered position,
 * entirely independent of the regular one — dragging this toolbar full
 * screen moves and remembers only where it sits full screen, leaving mode
 * never touches it, and re-entering returns it there. Mirrors
 * DeckPageHeader's own two-positions-per-mode model; see docs/DECISIONS.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, GripVertical, Highlighter, Pen, SquarePen } from 'lucide-react'
import Tooltip from '../Tooltip'
import ColorThicknessPopover from './ColorThicknessPopover'
import { beginDrag, endDrag } from '../../hooks/dragGuard'
import {
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_THICKNESSES,
  PEN_COLORS,
  PEN_THICKNESSES,
  type Whiteboard,
} from './useWhiteboard'

interface Props {
  deckId: string
  whiteboard: Whiteboard
  /** Appends a blank whiteboard slide and arms the pen for drawing. */
  onNewWhiteboardSlide: () => void
  /**
   * Full-screen slide viewing is active (PLAY-5): this toolbar has to stay
   * reachable over the full-screen overlay, which paints at the primary
   * nav's own z-50, and it tracks its OWN remembered position while this
   * is true — see the module docstring and the z-index tiers in
   * docs/DECISIONS.md.
   */
  fullScreen?: boolean
}

interface Point {
  x: number
  y: number
}

const MARGIN = 8
const NAV_HEIGHT = 56
const FOOTER_HEIGHT = 32
const DRAG_THRESHOLD = 4
const HOLD_MS = 350
const STORAGE_PREFIX = 'sm:wb-toolbar:'
/**
 * Full-screen positions live under a distinct key, not a field alongside
 * the regular one — an existing stored regular position (from before
 * PLAY-5) must go on meaning exactly what it always did, and a distinct
 * key is the simplest way to guarantee that.
 */
const fullScreenKey = (deckId: string): string => `${deckId}:fs`

const readStored = (key: string): Point | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Point>
    return typeof p?.x === 'number' && typeof p?.y === 'number'
      ? { x: p.x, y: p.y }
      : null
  } catch {
    return null
  }
}

const writeStored = (key: string, point: Point): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(point))
  } catch {
    // Private browsing: the toolbar still drags, it just won't be remembered.
  }
}

const clampToViewport = (point: Point, size: DOMRect): Point => {
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

/** Small corner triangle marking a tool that reveals more on press-and-hold
 * (its color/thickness picker). Clicking the triangle directly TOGGLES the same
 * picker, without the hold. Propagation is stopped so the parent button's own
 * click/hold don't fire, and — since the picker closes on an outside mousedown —
 * so a toggle-close isn't undone by that outside-close. The button keeps its
 * own label. */
const HoldHint = ({
  label,
  onToggle,
}: {
  label: string
  onToggle: () => void
}) => (
  <span
    aria-label={label}
    role="button"
    onPointerDown={e => e.stopPropagation()}
    onMouseDown={e => e.stopPropagation()}
    onClick={e => {
      e.stopPropagation()
      onToggle()
    }}
    className="absolute bottom-0 end-0 flex h-3 w-3 cursor-pointer items-end justify-end"
  >
    <svg
      viewBox="0 0 4 4"
      aria-hidden
      className="h-1.5 w-1.5 fill-current opacity-50"
    >
      <polygon points="4,0 4,4 0,4" />
    </svg>
  </span>
)

/** Initial position: just left of the first slide, top-aligned with it. Falls
 * back to a top-left perch before slides have laid out. */
const defaultPosition = (pill: DOMRect): Point => {
  const slide = document.querySelector('[data-slide-id]')
  if (slide) {
    const r = slide.getBoundingClientRect()
    return clampToViewport({ x: r.left - pill.width - MARGIN, y: r.top }, pill)
  }
  return { x: MARGIN, y: NAV_HEIGHT + MARGIN }
}

/**
 * Full-screen default position (PLAY-5): under the deck toolbar pill,
 * left-aligned with it. Measures the real pill via a dedicated data
 * attribute (`data-deck-toolbar-pill`), not a hard-coded offset and not
 * the `data-testid` — that is reserved for tests, and a rename or a
 * stripping transform on it would silently drop this to the fallback
 * perch below with nothing to say why. Falls back to that perch when the
 * pill cannot be found (it is always rendered, but a future refactor
 * might change that).
 */
const fullScreenPosition = (pill: DOMRect): Point => {
  const deckPill = document.querySelector('[data-deck-toolbar-pill]')
  if (deckPill) {
    const r = deckPill.getBoundingClientRect()
    return clampToViewport({ x: r.left, y: r.bottom + MARGIN }, pill)
  }
  return clampToViewport({ x: MARGIN, y: NAV_HEIGHT + MARGIN }, pill)
}

export default function WhiteboardToolbar({
  deckId,
  whiteboard,
  onNewWhiteboardSlide,
  fullScreen,
}: Props) {
  const {
    tool,
    toggleTool,
    setTool,
    penStyle,
    highlighterStyle,
    setPenStyle,
    setHighlighterStyle,
  } = whiteboard
  const { t } = useTranslation()
  const pillRef = useRef<HTMLDivElement>(null)
  // Two independent remembered positions (PLAY-5): null means "use that
  // mode's own default" (defaultPosition for regular, fullScreenPosition
  // for full screen), a point once dragged in that mode.
  const [pos, setPos] = useState<Point | null>(() => readStored(deckId))
  const [fsPos, setFsPos] = useState<Point | null>(() =>
    readStored(fullScreenKey(deckId)),
  )
  // Which tool's color/thickness popover is open (from a press-and-hold).
  const [picker, setPicker] = useState<'pen' | 'highlighter' | null>(null)

  const grabOffset = useRef<Point>({ x: 0, y: 0 })
  const pressRef = useRef<Point | null>(null)
  const draggedRef = useRef(false)
  const endDragRef = useRef<(() => void) | null>(null)
  useEffect(() => () => endDragRef.current?.(), [])

  // A pending re-anchor frame (see attachPill below), so an unmount or a
  // fresh full-screen toggle never lets a stale one land later.
  const anchorFrameRef = useRef<number | null>(null)
  // True only for a fresh, computed-from-the-deck-pill anchor that has not
  // yet been confirmed against a settled layout, and only until either the
  // confirming frame runs or a real drag starts — never for a restored
  // stored position, which is exact already and must not be touched.
  const pendingAnchorRef = useRef(false)
  useEffect(
    () => () => {
      if (anchorFrameRef.current !== null)
        cancelAnimationFrame(anchorFrameRef.current)
    },
    [],
  )

  /**
   * Places the pill on first layout when nothing is stored, and re-fits a
   * stored position to the current window — and, PLAY-5, re-anchors it
   * under the deck pill on entering full screen, or refits its regular
   * spot on leaving. `fullScreen` in the dependency array is what makes
   * this fire again on every full-screen toggle: React detaches and
   * reattaches a callback ref whenever its identity changes, calling it
   * with the (unchanged) DOM node again exactly as if it had just mounted
   * — without an Effect, so there is nothing here for the "no setState
   * synchronously in an Effect" rule to catch.
   *
   * A fresh (nothing-stored) full-screen anchor is measured again one
   * frame later: this callback fires in the same commit as DeckPageHeader
   * re-anchoring its OWN pill, and when the deck pill's stored full-screen
   * spot needs its own resize-clamp correction, that correction lands on
   * DeckPageHeader's very next render — after this measurement already
   * ran. Left alone, this toolbar would permanently lock onto the deck
   * pill's stale, pre-correction box. The follow-up frame runs after that
   * settles and repaints, and only overwrites if nothing else — a real
   * drag — has claimed the position since (`pendingAnchorRef`). A restored
   * stored position is untouched either way: `setFsPos`'s functional
   * updater below only marks the anchor pending when there was nothing
   * stored to restore, using the state at the moment it actually commits
   * rather than this closure's, which can only ever reflect the render
   * this particular attachPill instance was created in.
   */
  const attachPill = useCallback(
    (el: HTMLDivElement | null) => {
      pillRef.current = el
      if (anchorFrameRef.current !== null) {
        cancelAnimationFrame(anchorFrameRef.current)
        anchorFrameRef.current = null
      }
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (fullScreen) {
        setFsPos(current => {
          if (current) return clampToViewport(current, rect)
          pendingAnchorRef.current = true
          return fullScreenPosition(rect)
        })
        anchorFrameRef.current = requestAnimationFrame(() => {
          anchorFrameRef.current = null
          if (!pendingAnchorRef.current) return
          pendingAnchorRef.current = false
          const settled = pillRef.current
          if (!settled) return
          setFsPos(fullScreenPosition(settled.getBoundingClientRect()))
        })
        return
      }
      setPos(current =>
        current ? clampToViewport(current, rect) : defaultPosition(rect),
      )
    },
    [fullScreen],
  )

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = pillRef.current!.getBoundingClientRect()
    // Captured once, at the moment the press starts: full screen cannot
    // toggle mid-drag, so this is simply "whichever mode this drag is in".
    const draggingFullScreen = fullScreen
    pressRef.current = { x: e.clientX, y: e.clientY }
    draggedRef.current = false
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    const onMove = (ev: PointerEvent) => {
      const press = pressRef.current!
      if (!draggedRef.current) {
        if (
          Math.hypot(ev.clientX - press.x, ev.clientY - press.y) <
          DRAG_THRESHOLD
        )
          return
        draggedRef.current = true
        // A real drag claims the position: the pending re-anchor frame
        // (attachPill above) must not overwrite it once the pointer is
        // actually moving it.
        pendingAnchorRef.current = false
        // Blocks the full-screen shortcuts for the rest of this gesture
        // (dragGuard.ts) — a mid-drag mode toggle would otherwise teleport
        // this toolbar to the OTHER mode's spot without releasing the
        // pointer, corrupting the mode the drag actually started in.
        beginDrag()
      }
      const box = pillRef.current!.getBoundingClientRect()
      const next = clampToViewport(
        {
          x: ev.clientX - grabOffset.current.x,
          y: ev.clientY - grabOffset.current.y,
        },
        box,
      )
      // Full screen (PLAY-5): a drag moves and remembers only the
      // full-screen spot, never the regular one, and vice versa.
      if (draggingFullScreen) setFsPos(next)
      else setPos(next)
    }
    const onUp = () => {
      pressRef.current = null
      if (draggedRef.current) endDrag()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      endDragRef.current = null
      const key = draggingFullScreen ? fullScreenKey(deckId) : deckId
      const setThisMode = draggingFullScreen ? setFsPos : setPos
      setThisMode(current => {
        if (current) writeStored(key, current)
        return current
      })
    }
    endDragRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // A shrinking window must not strand the pill off-screen, in or out of
  // full screen.
  useEffect(() => {
    const onResize = () => {
      const el = pillRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (fullScreen) {
        setFsPos(current =>
          current ? clampToViewport(current, rect) : current,
        )
      } else {
        setPos(current => (current ? clampToViewport(current, rect) : current))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fullScreen])

  // Press-and-hold on a drawing tool selects it AND opens its color/thickness
  // popover; a quick press just selects it. Held is tracked so the trailing
  // click is ignored (the hold already selected the tool).
  const holdTimer = useRef<number | null>(null)
  const heldRef = useRef(false)

  const startHold = (kind: 'pen' | 'highlighter') => {
    heldRef.current = false
    holdTimer.current = window.setTimeout(() => {
      heldRef.current = true
      setTool(kind) // holding selects the tool, not just opens the picker
      setPicker(kind)
    }, HOLD_MS)
  }
  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }
  const handleToolClick = (kind: 'pen' | 'highlighter') => {
    clearHold()
    if (heldRef.current) {
      heldRef.current = false
      return // the hold opened the popover; don't also toggle
    }
    toggleTool(kind)
  }
  // The corner-triangle shortcut: toggle the tool's color/thickness picker.
  // Opening it also selects the tool (like a press-and-hold); closing leaves
  // the tool as-is.
  const togglePicker = (kind: 'pen' | 'highlighter') => {
    const willOpen = picker !== kind
    if (willOpen) setTool(kind)
    setPicker(willOpen ? kind : null)
  }

  const buttonClass = (kind: 'pen' | 'highlighter' | 'eraser'): string =>
    `relative rounded-md p-2 ${
      tool === kind
        ? 'bg-indigo-50 text-indigo-600'
        : 'text-slate-500 hover:text-slate-900'
    }`

  return (
    <div
      ref={attachPill}
      data-testid="whiteboard-toolbar"
      style={(() => {
        // Full screen (PLAY-5): that mode's own remembered spot, never the
        // regular one — so leaving full screen restores the regular spot
        // untouched, and re-entering returns to wherever full screen was
        // left.
        const point = fullScreen ? fsPos : pos
        return point
          ? { left: point.x, top: point.y }
          : { left: MARGIN, top: NAV_HEIGHT + MARGIN }
      })()}
      // z-30 page-chrome tier: above slide content + the drawing canvas (z-20),
      // below modals and the primary nav. Full screen (PLAY-5) raises it to
      // z-[55], above the full-screen overlay's own z-50 (docs/DECISIONS.md)
      // — a plain fixed positioning + z-index bump is enough here: nothing
      // between this toolbar and the document root establishes a stacking
      // context of its own (no transform/opacity/filter ancestor), so the
      // z-index tier alone decides the paint order.
      className={`fixed ${fullScreen ? 'z-[55]' : 'z-30'} flex select-none flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 px-1.5 py-2 shadow-lg backdrop-blur`}
    >
      <Tooltip label={t('deck.toolbar.drag')} align="start">
        <button
          aria-label={t('whiteboard.dragHint')}
          onPointerDown={startDrag}
          className="cursor-grab touch-none rounded-md p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>

      <div className="flex flex-col items-center gap-1">
        {/* Each drawing tool wraps its popover so it expands to the right of
            THAT button, not the top of the group. */}
        <div className="relative">
          <Tooltip label={t('whiteboard.pen')} align="start">
            <button
              aria-label={t('whiteboard.pen')}
              aria-pressed={tool === 'pen'}
              className={buttonClass('pen')}
              onPointerDown={() => startHold('pen')}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onClick={() => handleToolClick('pen')}
            >
              <Pen className="h-5 w-5" aria-hidden />
              <HoldHint
                label={t('whiteboard.picker.options')}
                onToggle={() => togglePicker('pen')}
              />
            </button>
          </Tooltip>
          {picker === 'pen' && (
            <ColorThicknessPopover
              label={t('whiteboard.pen')}
              colors={PEN_COLORS}
              thicknesses={PEN_THICKNESSES}
              value={penStyle}
              onChange={setPenStyle}
              onClose={() => setPicker(null)}
            />
          )}
        </div>
        <div className="relative">
          <Tooltip label={t('whiteboard.highlighter')} align="start">
            <button
              aria-label={t('whiteboard.highlighter')}
              aria-pressed={tool === 'highlighter'}
              className={buttonClass('highlighter')}
              onPointerDown={() => startHold('highlighter')}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onClick={() => handleToolClick('highlighter')}
            >
              <Highlighter className="h-5 w-5" aria-hidden />
              <HoldHint
                label={t('whiteboard.picker.options')}
                onToggle={() => togglePicker('highlighter')}
              />
            </button>
          </Tooltip>
          {picker === 'highlighter' && (
            <ColorThicknessPopover
              label={t('whiteboard.highlighter')}
              colors={HIGHLIGHTER_COLORS}
              thicknesses={HIGHLIGHTER_THICKNESSES}
              value={highlighterStyle}
              onChange={setHighlighterStyle}
              onClose={() => setPicker(null)}
            />
          )}
        </div>
        <Tooltip label={t('whiteboard.eraser')} align="start">
          <button
            aria-label={t('whiteboard.eraser')}
            aria-pressed={tool === 'eraser'}
            className={buttonClass('eraser')}
            onClick={() => toggleTool('eraser')}
          >
            <Eraser className="h-5 w-5" aria-hidden />
          </button>
        </Tooltip>

        {/* New whiteboard slide: appends a blank canvas and arms the pen.
            Separated from the tools by a divider — it acts, it doesn't select. */}
        <div className="my-0.5 h-px w-6 bg-slate-200" />
        <Tooltip label={t('whiteboard.newSlide')} align="start">
          <button
            aria-label={t('whiteboard.newSlide')}
            className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            onClick={onNewWhiteboardSlide}
          >
            <SquarePen className="h-5 w-5" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
