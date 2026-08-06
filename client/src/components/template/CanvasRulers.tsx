/**
 * Rulers down the right and along the bottom of the preview, and the guides
 * pulled off them.
 *
 * Drag off a ruler to make a guide, as in any design tool: drag up off the
 * bottom ruler and a horizontal line follows your finger; drag left off the
 * right one and a vertical line does. A guide snaps to the ten percent marks
 * as it moves, boxes snap to guides, and dropping a guide back on the ruler it
 * came from removes it — the same gesture, reversed.
 *
 * A drag is not reachable from a keyboard, and no route here is a lesser one:
 * a ruler is focusable and Enter adds a guide down the middle, arrows move a
 * focused guide by a mark, and Delete removes it.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LayoutGuides } from '@slide-machine/shared'
import { TICK, snapToTicks } from './geometry'

/**
 * Which way a guide runs. A vertical line sits at an `x` position and is
 * pulled off the right ruler; a horizontal one sits at `y` and comes off the
 * bottom. So the axis names the coordinate the guide *has*, not the direction
 * it is drawn in — which is why the ruler you drag from is the one at right
 * angles to the line you get.
 */
type Axis = 'x' | 'y'

interface Dragging {
  axis: Axis
  /** Its place in that axis's list, or -1 while still being pulled off. */
  index: number
  at: number
  /** True once the pointer is back over the ruler, so dropping deletes. */
  discarding: boolean
}

/** How close to the ruler counts as dropping the guide back onto it. */
const DISCARD_BAND = 0.04

const EMPTY: LayoutGuides = { x: [], y: [] }

/** Both guide axes. Hoisted: an array literal inside JSX reads as content to
 * the i18n lint rule. */
const AXES: Axis[] = ['x', 'y']

export default function CanvasRulers({
  canvasRef,
  guides = EMPTY,
  onChange,
  onRecord,
}: {
  /** The preview the guides lie over; measured to turn a pointer position
   * into a fraction of the slide. */
  canvasRef: React.RefObject<HTMLDivElement | null>
  guides?: LayoutGuides
  onChange: (next: LayoutGuides) => void
  /** Called once at the start of each gesture, so a drag is one undo step. */
  onRecord: () => void
}) {
  const { t } = useTranslation()
  const [drag, setDrag] = useState<Dragging | null>(null)
  const dragRef = useRef<Dragging | null>(null)

  const set = (axis: Axis, next: number[]) =>
    onChange({ ...guides, [axis]: next })

  /** Where the pointer is, as a fraction of the canvas along one axis. */
  const fractionAt = (axis: Axis, e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return 0
    return axis === 'x'
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height
  }

  /**
   * Runs a guide drag to its end.
   *
   * The listeners go on the window and the gesture's state in a ref: a
   * re-render between moves must not change what is being dragged, and the
   * pointer routinely leaves the element it started on.
   */
  const beginDrag = (axis: Axis, index: number, from: number) => {
    onRecord()
    const start: Dragging = { axis, index, at: from, discarding: false }
    dragRef.current = start
    setDrag(start)
    const before = guides[axis]

    const move = (ev: PointerEvent) => {
      const raw = fractionAt(axis, ev)
      const at = Math.min(1, Math.max(0, snapToTicks(raw)))
      // Past the far edge means the pointer is back over the ruler, which is
      // how a guide is thrown away.
      const discarding = raw > 1 - DISCARD_BAND || raw < 0
      dragRef.current = { axis, index, at, discarding }
      setDrag(dragRef.current)
      const list = [...before]
      if (index < 0) list.push(at)
      else list[index] = at
      set(axis, list)
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const final = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!final) return
      const list = [...before]
      if (final.discarding) {
        // Dropped back on its ruler: gone. A guide that was never added
        // simply is not.
        if (final.index >= 0) list.splice(final.index, 1)
        set(axis, list)
        return
      }
      if (final.index < 0) set(axis, [...list, final.at])
      else {
        list[final.index] = final.at
        set(axis, list)
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onGuideKey =
    (axis: Axis, index: number) => (e: React.KeyboardEvent) => {
      const at = guides[axis][index]
      if (at === undefined) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onRecord()
        set(
          axis,
          guides[axis].filter((_, i) => i !== index),
        )
        return
      }
      const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
      const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
      if (e.key !== back && e.key !== forward) return
      e.preventDefault()
      onRecord()
      // Shift steps between the marks, for a guide that has to sit somewhere
      // the grid does not.
      const step = e.shiftKey ? TICK / 5 : TICK
      const moved = Math.min(
        1,
        Math.max(0, at + (e.key === forward ? step : -step)),
      )
      set(
        axis,
        guides[axis].map((g, i) => (i === index ? moved : g)),
      )
    }

  const edges: Array<'bottom' | 'right'> = ['bottom', 'right']

  return (
    <>
      {edges.map(edge => (
        <Ruler
          key={edge}
          edge={edge}
          label={t(`template.ruler.${edge}`)}
          onGrab={e => {
            const axis: Axis = edge === 'bottom' ? 'y' : 'x'
            beginDrag(axis, -1, snapToTicks(fractionAt(axis, e)))
          }}
          onAdd={() => {
            const axis: Axis = edge === 'bottom' ? 'y' : 'x'
            onRecord()
            set(axis, [...guides[axis], 0.5])
          }}
        />
      ))}
      {AXES.flatMap(axis =>
        guides[axis].map((at, index) => (
          <Guide
            key={`${axis}-${index}`}
            axis={axis}
            at={at}
            label={t(`template.guideAt.${axis}`, {
              percent: Math.round(at * 100),
            })}
            discarding={Boolean(drag?.discarding && drag.axis === axis)}
            onGrab={() => beginDrag(axis, index, at)}
            onKeyDown={onGuideKey(axis, index)}
          />
        )),
      )}
    </>
  )
}

/** The marks, computed from the grid rather than listed. */
const TICKS = Array.from({ length: Math.round(1 / TICK) + 1 }, (_, i) =>
  Number((i * TICK).toFixed(2)),
)

/**
 * One ruler. A component rather than a function called during render, so its
 * handlers are handlers — the ones that read the canvas ref must not look
 * like something React runs while deciding what to draw.
 */
function Ruler({
  edge,
  label,
  onGrab,
  onAdd,
}: {
  edge: 'bottom' | 'right'
  label: string
  onGrab: (e: React.PointerEvent) => void
  onAdd: () => void
}) {
  const horizontal = edge === 'bottom'
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={e => {
        e.preventDefault()
        onGrab(e)
      }}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onAdd()
      }}
      className={
        horizontal
          ? 'absolute top-full right-0 left-0 h-4 cursor-row-resize border-t border-slate-300 bg-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none'
          : 'absolute top-0 bottom-0 left-full w-4 cursor-col-resize border-l border-slate-300 bg-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none'
      }
    >
      {TICKS.map(at => (
        <span
          key={at}
          aria-hidden
          className={
            horizontal
              ? `absolute top-0 w-px bg-slate-400 ${at === 0.5 ? 'h-2.5' : 'h-1.5'}`
              : `absolute left-0 h-px bg-slate-400 ${at === 0.5 ? 'w-2.5' : 'w-1.5'}`
          }
          style={
            horizontal ? { left: `${at * 100}%` } : { top: `${at * 100}%` }
          }
        />
      ))}
    </div>
  )
}

/** One guide, drawn across the slide and grabbable anywhere along it. */
function Guide({
  axis,
  at,
  label,
  discarding,
  onGrab,
  onKeyDown,
}: {
  axis: Axis
  at: number
  label: string
  /** Over a ruler, so letting go throws it away rather than dropping it. */
  discarding: boolean
  onGrab: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const vertical = axis === 'x'
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(at * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={e => {
        e.preventDefault()
        onGrab()
      }}
      onKeyDown={onKeyDown}
      className={
        vertical
          ? 'absolute top-0 bottom-0 z-10 w-2 -translate-x-1 cursor-col-resize focus:outline-none'
          : 'absolute right-0 left-0 z-10 h-2 -translate-y-1 cursor-row-resize focus:outline-none'
      }
      style={vertical ? { left: `${at * 100}%` } : { top: `${at * 100}%` }}
    >
      <span
        aria-hidden
        className={`absolute ${discarding ? 'bg-red-400' : 'bg-fuchsia-500'} ${
          vertical ? 'top-0 bottom-0 left-1 w-px' : 'top-1 right-0 left-0 h-px'
        }`}
      />
    </div>
  )
}
