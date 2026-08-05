/**
 * Arranging one layout (TMPL-4): where each slot sits on the slide.
 *
 * Drag a box to move it, drag its corner to resize. A drag is not reachable
 * from a keyboard, so each box is focusable too: arrows move it, shift and
 * arrows resize it. Both routes write the same percentages, so neither is a
 * lesser path.
 *
 * A layout with no arrangement keeps its hand-tuned component — that is what
 * every built-in does. Arranging one is opt-in, and clearing it hands the
 * layout back (docs/TEMPLATES.md).
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ElementPositions, Layout, SlotBox } from '@slide-machine/shared'

/** How far one arrow-key press moves or resizes a box, in percent. */
const NUDGE = 2

/** Which way each arrow points, as a delta. */
const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

/** Keeps a box inside the slide and larger than a hairline, whichever way it
 * was moved. Percentages, so this is the same maths at any render size. */
const clampBox = (box: SlotBox): SlotBox => {
  const w = Math.min(100, Math.max(5, box.w))
  const h = Math.min(100, Math.max(5, box.h))
  return {
    w,
    h,
    x: Math.min(100 - w, Math.max(0, box.x)),
    y: Math.min(100 - h, Math.max(0, box.y)),
  }
}

/**
 * A starting arrangement: the slots stacked down the slide with a margin.
 * Computed from however many slots the layout has rather than written down,
 * so it fits a layout with two slots and one with six.
 */
const seedPositions = (layout: Layout): ElementPositions => {
  const slots = layout.slots
  if (slots.length === 0) return {}
  const margin = 6
  const gap = 3
  const usable = 100 - margin * 2
  const height = (usable - gap * (slots.length - 1)) / slots.length
  return Object.fromEntries(
    slots.map((slot, i) => [
      slot.name,
      {
        x: margin,
        y: margin + i * (height + gap),
        w: usable,
        h: height,
      },
    ]),
  )
}

export default function TemplateArrangement({
  layout,
  onChange,
}: {
  layout: Layout
  onChange: (positions: ElementPositions) => void
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const positions = layout.elementPositions ?? {}
  const arranged = Object.keys(positions).length > 0

  const setBox = (name: string, patch: Partial<SlotBox>) => {
    const current = positions[name]
    if (!current) return
    onChange({ ...positions, [name]: clampBox({ ...current, ...patch }) })
  }

  /** Moves a box with the pointer, in canvas percentages. */
  const onPointerDown = (name: string) => (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    const box = positions[name]
    if (!canvas || !box) return
    const rect = canvas.getBoundingClientRect()
    // Where in the box the pointer grabbed it, so it does not jump to the
    // cursor on the first move.
    const grabX = ((e.clientX - rect.left) / rect.width) * 100 - box.x
    const grabY = ((e.clientY - rect.top) / rect.height) * 100 - box.y
    setDragging(name)

    const move = (ev: PointerEvent) => {
      setBox(name, {
        x: ((ev.clientX - rect.left) / rect.width) * 100 - grabX,
        y: ((ev.clientY - rect.top) / rect.height) * 100 - grabY,
      })
    }
    const up = () => {
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Resizes from the bottom-right corner. The box keeps its top-left, so
   * dragging the handle only ever changes width and height. */
  const onResizeDown = (name: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const canvas = canvasRef.current
    const box = positions[name]
    if (!canvas || !box) return
    const rect = canvas.getBoundingClientRect()
    setDragging(name)

    const move = (ev: PointerEvent) => {
      setBox(name, {
        w: ((ev.clientX - rect.left) / rect.width) * 100 - box.x,
        h: ((ev.clientY - rect.top) / rect.height) * 100 - box.y,
      })
    }
    const up = () => {
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Arrows move the focused box; with shift they resize it. */
  const onKeyDown = (name: string) => (e: React.KeyboardEvent) => {
    const arrow = ARROWS[e.key]
    const box = positions[name]
    if (!arrow || !box) return
    e.preventDefault()
    setBox(
      name,
      e.shiftKey
        ? { w: box.w + arrow.dx * NUDGE, h: box.h + arrow.dy * NUDGE }
        : { x: box.x + arrow.dx * NUDGE, y: box.y + arrow.dy * NUDGE },
    )
  }

  if (!arranged) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(seedPositions(layout))}
          disabled={layout.slots.length === 0}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {t('template.arrange')}
        </button>
        <span className="text-xs text-slate-500">
          {t('template.arrangeHint')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {t('template.arrangeDragHint')}
        </span>
        <button
          type="button"
          onClick={() => onChange({})}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('template.arrangeReset')}
        </button>
      </div>

      <div
        ref={canvasRef}
        className="relative aspect-video w-full rounded-md border border-dashed border-slate-300 bg-slate-50"
      >
        {layout.slots.map(slot => {
          const box = positions[slot.name]
          if (!box) return null
          return (
            <div
              key={slot.name}
              tabIndex={0}
              // The box is the control: its label carries where it sits, so
              // someone who cannot see the canvas still knows.
              aria-label={t('template.boxAt', {
                slot: slot.name,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.w),
                h: Math.round(box.h),
              })}
              onPointerDown={onPointerDown(slot.name)}
              onKeyDown={onKeyDown(slot.name)}
              className={`absolute flex cursor-move items-center justify-center rounded border text-[0.6rem] font-medium select-none focus:ring-2 focus:ring-indigo-500 focus:outline-none ${
                dragging === slot.name
                  ? 'border-indigo-500 bg-indigo-100'
                  : 'border-slate-400 bg-white/80'
              }`}
              style={{
                left: `${box.x}%`,
                top: `${box.y}%`,
                width: `${box.w}%`,
                height: `${box.h}%`,
              }}
            >
              {slot.name}
              <span
                aria-hidden
                onPointerDown={onResizeDown(slot.name)}
                className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize rounded-br border-r-2 border-b-2 border-slate-500"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
