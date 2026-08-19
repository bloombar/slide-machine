/**
 * The grab handle on the boundary between two of a table's columns or rows
 * (EDIT-7).
 *
 * A table divided into equal columns gives a year the same width as a
 * sentence, so the boundaries are draggable. The handle sits over the rule it
 * moves, invisible until the table is hovered or focused, so a slide being read
 * is not covered in furniture.
 *
 * ## Fractions, measured from the table
 *
 * A drag reports how far it moved as a fraction of the table's own width or
 * height, read from the table element at the moment the drag starts. The
 * editor draws the slide at whatever size the pane allows — and scaled, at
 * that — so pixels mean nothing on their own, while a fraction means the same
 * thing here, in the viewer, and in an export.
 *
 * ## Not only a drag
 *
 * A boundary that can only be dragged cannot be moved by someone using a
 * keyboard, and a table is exactly the content where column widths matter
 * most. So the handle is a real `separator` control that takes arrow keys, and
 * it says which boundary it is.
 */
import { useRef } from 'react'

/** How far an arrow key moves a boundary, as a fraction of the table. Small
 * enough to place a column, large enough to cross one in a few presses. */
const STEP = 0.02

interface Props {
  /** `vertical` for the rule between two columns, which moves side to side. */
  orientation: 'vertical' | 'horizontal'
  /** What this boundary is, for a screen reader. */
  label: string
  /** The table this boundary belongs to, whose size the fractions are of. */
  tableRef: React.RefObject<HTMLTableElement | null>
  /** Called with how much the track before the boundary just gained. */
  onResize: (by: number) => void
}

export default function TrackHandle({
  orientation,
  label,
  tableRef,
  onResize,
}: Props) {
  const vertical = orientation === 'vertical'
  // Where the pointer was at the last report, so each move applies only what
  // has changed since. Tracking the whole drag from its start would need the
  // sizes it started from, and the stored sizes are the truth here.
  const last = useRef<number | null>(null)

  /** The table's width or height in pixels, whichever this handle moves. */
  const extent = (): number => {
    const rect = tableRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return vertical ? rect.width : rect.height
  }

  const report = (to: number) => {
    const from = last.current
    const size = extent()
    // A table with no measured size — still laying out, or hidden — gives a
    // fraction of nothing, and dividing by it would resize by infinity.
    if (from === null || !size) return
    last.current = to
    onResize((to - from) / size)
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={e => {
        // Captured, so a drag that leaves the handle — which every drag does —
        // keeps arriving here rather than stopping at the edge of a 4px strip.
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = vertical ? e.clientX : e.clientY
        // Otherwise the drag selects the text in the cells it crosses.
        e.preventDefault()
      }}
      onPointerMove={e => report(vertical ? e.clientX : e.clientY)}
      onPointerUp={() => {
        last.current = null
      }}
      onPointerCancel={() => {
        last.current = null
      }}
      onKeyDown={e => {
        const by = vertical
          ? { ArrowLeft: -STEP, ArrowRight: STEP }[e.key]
          : { ArrowUp: -STEP, ArrowDown: STEP }[e.key]
        if (by === undefined) return
        // The arrow would otherwise scroll the pane out from under the table.
        e.preventDefault()
        onResize(by)
      }}
      className={[
        // Over the rule itself, and wider than it: a one-pixel target is not
        // one anybody hits.
        'absolute z-10 opacity-0 transition-opacity',
        'group-hover:opacity-40 group-focus-within:opacity-40',
        'hover:opacity-100 focus:opacity-100 focus:outline-none',
        'bg-current',
        vertical
          ? '-end-[0.4cqi] top-0 h-full w-[0.8cqi] cursor-col-resize'
          : '-bottom-[0.4cqi] start-0 h-[0.8cqi] w-full cursor-row-resize',
      ].join(' ')}
    />
  )
}
