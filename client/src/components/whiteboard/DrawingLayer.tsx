/**
 * Canvas overlay that captures freehand drawing on slides and paints saved
 * strokes (WB-1). It covers a positioned container (its parent must be
 * `relative`) and finds each slide box inside it via `[data-slide-id]`, so one
 * layer serves a single slide (carousel) or many (list). While a tool is
 * active it takes pointer events; otherwise it is transparent to clicks so
 * normal editing/nav keep working.
 *
 * Playback (WB-2): when `isPlaying`, a requestAnimationFrame loop repaints each
 * frame and `reveal` decides per-stroke visibility (drawn-yet / erased-yet)
 * from the live audio position — kept off React state to avoid re-render churn.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Stroke, StrokeAnchor } from '@slide-machine/shared'
import {
  hitTestStroke,
  nearestSlideToCentroid,
  normalizePoint,
  strokeCentroid,
  type Box,
  type SlideBox,
} from '../../lib/drawing'
import {
  HIGHLIGHTER_ALPHA,
  type ToolStyle,
  type WhiteboardTool,
} from './useWhiteboard'

interface Props {
  tool: WhiteboardTool
  penStyle: ToolStyle
  highlighterStyle: ToolStyle
  /** Saved strokes per slide id. */
  strokesById: Record<string, Stroke[]>
  /** True while narration is playing — drives the reveal rAF loop. */
  isPlaying?: boolean
  /** Playback visibility predicate; only consulted while `isPlaying`. */
  reveal?: (slideId: string, stroke: Stroke) => boolean
  /** Builds a transcript timing anchor for an event on a slide (WB-2). */
  buildAnchor: (slideId: string, atWallMs: number) => StrokeAnchor
  onCommitStroke: (slideId: string, stroke: Stroke) => void
  onEraseStroke: (
    slideId: string,
    strokeId: string,
    anchor: StrokeAnchor,
  ) => void
  /** Fired on each drawing/erasing gesture so the page can tell the user is
   * actively marking up a slide (WB-3), keeping auto-slide-creation suppressed. */
  onActivity?: () => void
}

/** An in-progress gesture, kept in client coordinates for live preview. */
interface Draft {
  tool: 'pen' | 'highlighter'
  color: string
  thicknessPx: number
  points: { x: number; y: number }[]
  startWall: number
}

const rectToBox = (r: DOMRect): Box => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
})

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function DrawingLayer({
  tool,
  penStyle,
  highlighterStyle,
  strokesById,
  isPlaying,
  reveal,
  buildAnchor,
  onCommitStroke,
  onEraseStroke,
  onActivity,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<Draft | null>(null)
  const erasingRef = useRef(false)

  /** Current slide boxes inside the container, in client coordinates. */
  const getSlideBoxes = (): SlideBox[] => {
    const container = canvasRef.current?.parentElement
    if (!container) return []
    return Array.from(container.querySelectorAll('[data-slide-id]')).map(
      el => ({
        slideId: el.getAttribute('data-slide-id') ?? '',
        box: rectToBox(el.getBoundingClientRect()),
      }),
    )
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const visible = (slideId: string, stroke: Stroke): boolean =>
      isPlaying && reveal ? reveal(slideId, stroke) : !stroke.erasedAnchor

    for (const { slideId, box } of getSlideBoxes()) {
      for (const stroke of strokesById[slideId] ?? []) {
        if (!visible(slideId, stroke)) continue
        drawStroke(ctx, stroke, box, rect)
      }
    }
    if (draftRef.current) drawDraft(ctx, draftRef.current, rect)
  }, [strokesById, isPlaying, reveal])

  // Repaint whenever saved strokes change (save round-trip, erase, etc.).
  useEffect(() => {
    redraw()
  }, [strokesById, redraw])

  // Keep the canvas sized to its container and repaint on layout changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => redraw())
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  // Reveal loop: while narration plays, repaint every frame so strokes appear
  // and erased strokes disappear in step with the audio position (WB-2).
  useEffect(() => {
    if (!isPlaying) {
      redraw()
      return
    }
    let raf = 0
    const tick = () => {
      redraw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, redraw])

  const slideBoxAt = (
    boxes: SlideBox[],
    x: number,
    y: number,
  ): SlideBox | undefined =>
    boxes.find(
      b =>
        x >= b.box.left &&
        x <= b.box.left + b.box.width &&
        y >= b.box.top &&
        y <= b.box.top + b.box.height,
    )

  const tryErase = (clientX: number, clientY: number) => {
    const under = slideBoxAt(getSlideBoxes(), clientX, clientY)
    if (!under) return
    for (const stroke of strokesById[under.slideId] ?? []) {
      if (stroke.erasedAnchor) continue // already erased — nothing to hit
      if (hitTestStroke(clientX, clientY, stroke, under.box)) {
        onEraseStroke(
          under.slideId,
          stroke.id,
          buildAnchor(under.slideId, Date.now()),
        )
        break // one stroke per hit
      }
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || e.button !== 0) return
    canvasRef.current?.setPointerCapture(e.pointerId)
    onActivity?.() // a gesture began — the user is actively marking up (WB-3)
    if (tool === 'eraser') {
      erasingRef.current = true
      tryErase(e.clientX, e.clientY)
      return
    }
    const style = tool === 'highlighter' ? highlighterStyle : penStyle
    const under = slideBoxAt(getSlideBoxes(), e.clientX, e.clientY)
    const width = under?.box.width ?? canvasRef.current?.clientWidth ?? 0
    draftRef.current = {
      tool,
      color: style.color,
      thicknessPx: Math.max(1, style.thickness * width),
      points: [{ x: e.clientX, y: e.clientY }],
      startWall: Date.now(),
    }
    redraw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'eraser') {
      if (erasingRef.current) {
        onActivity?.()
        tryErase(e.clientX, e.clientY)
      }
      return
    }
    if (!draftRef.current) return
    onActivity?.()
    draftRef.current.points.push({ x: e.clientX, y: e.clientY })
    redraw()
  }

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.releasePointerCapture?.(e.pointerId)
    if (tool === 'eraser') {
      erasingRef.current = false
      return
    }
    const draft = draftRef.current
    draftRef.current = null
    if (!draft) return
    const boxes = getSlideBoxes()
    const centroid = strokeCentroid(draft.points)
    const targetId = centroid && nearestSlideToCentroid(centroid, boxes)
    const target = boxes.find(b => b.slideId === targetId)
    if (!target || !targetId) {
      redraw()
      return
    }
    const style = draft.tool === 'highlighter' ? highlighterStyle : penStyle
    const stroke: Stroke = {
      id: uuid(),
      tool: draft.tool,
      color: draft.color,
      thickness: style.thickness,
      points: draft.points.map(pt => normalizePoint(pt.x, pt.y, target.box)),
      startedAt: new Date(draft.startWall).toISOString(),
      endedAt: new Date().toISOString(),
      anchor: buildAnchor(targetId, draft.startWall),
    }
    onCommitStroke(targetId, stroke)
    redraw()
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="drawing-layer"
      /*
       * How many saved strokes this layer can currently act on.
       *
       * Erasing hit-tests against the SAVED strokes, which arrive back as
       * props after the save round-trip — so there is a window where a stroke
       * has been drawn and stored but the layer cannot yet erase it. Nothing
       * about the canvas shows that: it is painted, not marked up, so a test
       * that erases as soon as the save responds is guessing at state it
       * cannot see, and under load it guesses wrong.
       *
       * Stated here so it can be waited for instead.
       */
      data-erasable={Object.values(strokesById).reduce(
        (n, strokes) => n + strokes.filter(s => !s.erasedAnchor).length,
        0,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      // Above in-slide controls (z-10), below the page chrome / toolbars (z-30).
      className={`absolute inset-0 z-20 h-full w-full ${
        tool
          ? 'pointer-events-auto cursor-crosshair touch-none'
          : 'pointer-events-none'
      }`}
    />
  )
}

/** Paints one saved stroke, mapping its normalized points into the slide box
 * and then into canvas-local (container-relative) coordinates. */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  box: Box,
  container: DOMRect,
) {
  const pts = stroke.points
  if (!pts.length) return
  ctx.save()
  ctx.globalAlpha = stroke.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = Math.max(1, stroke.thickness * box.width)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const localX = (nx: number) => box.left + nx * box.width - container.left
  const localY = (ny: number) => box.top + ny * box.height - container.top
  if (pts.length === 1) {
    // A tap with no travel: render as a filled dot the width of the line.
    ctx.beginPath()
    ctx.arc(
      localX(pts[0]!.x),
      localY(pts[0]!.y),
      ctx.lineWidth / 2,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  } else {
    ctx.beginPath()
    pts.forEach((pt, i) => {
      const x = localX(pt.x)
      const y = localY(pt.y)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
  ctx.restore()
}

/** Paints the in-progress gesture directly from client coordinates. */
function drawDraft(
  ctx: CanvasRenderingContext2D,
  draft: Draft,
  container: DOMRect,
) {
  const pts = draft.points
  if (!pts.length) return
  ctx.save()
  ctx.globalAlpha = draft.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1
  ctx.strokeStyle = draft.color
  ctx.fillStyle = draft.color
  ctx.lineWidth = draft.thicknessPx
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(
      pts[0]!.x - container.left,
      pts[0]!.y - container.top,
      ctx.lineWidth / 2,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  } else {
    ctx.beginPath()
    pts.forEach((pt, i) => {
      const x = pt.x - container.left
      const y = pt.y - container.top
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
  ctx.restore()
}
