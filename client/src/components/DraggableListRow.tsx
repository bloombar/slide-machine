/**
 * Reorderable list row, generalizable to any vertical list. Pointer
 * dragging comes from Atlassian's pragmatic-drag-and-drop (each row is
 * both draggable and a drop target). Alt+ArrowUp/Down on the focused row
 * is the keyboard path, always available regardless of the drag surface.
 *
 * By default the whole row is the drag surface, and a drag never starts
 * from an interactive or editable element inside it (so click-to-edit
 * keeps working) — what slide rows use, since a slide's surface is mostly
 * non-interactive. `handleOnly` inverts that: a drag may start ONLY from a
 * descendant carrying `data-drag-handle` — for a row that is a link end to
 * end (a lecture row, PROJ-4), where "everywhere but the interactive bits"
 * leaves nothing usable.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'

/** True when dragging from `target` would steal a click or text edit. */
const isInteractive = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, button, a, [role="button"], [contenteditable="true"]',
  ) !== null

/** True when `target` is inside the row's nominated drag handle. */
const isDragHandle = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-drag-handle]') !== null

interface Props {
  /** Stable identity carried through the drag. */
  id: string
  index: number
  /** Accessible name for the row (e.g. "Slide 1"). */
  label: string
  /** A drag dropped onto this row: move `sourceId` to this row's index. */
  onDropOn: (sourceId: string, targetIndex: number) => void
  /** Keyboard path: move this row one step up or down. */
  onKeyMove: (id: string, delta: -1 | 1) => void
  /** Ref for external consumers (e.g. scroll-into-view registration). */
  itemRef?: (el: HTMLLIElement | null) => void
  /** Extra classes for the row itself — e.g. off-screen deferral on a list
   * long enough to be worth it. The row's own drag styling is kept. */
  className?: string
  /** Restricts the drag surface to a `data-drag-handle` descendant instead
   * of the whole row (see the module doc). The row still supplies its own
   * handle as a child of `children`; this only changes where a pointer may
   * pick it up from. */
  handleOnly?: boolean
  children: ReactNode
}

export default function DraggableListRow({
  id,
  index,
  label,
  onDropOn,
  onKeyMove,
  itemRef,
  className = '',
  handleOnly = false,
  children,
}: Props) {
  const rowRef = useRef<HTMLLIElement | null>(null)
  // Whether the pointer went down somewhere a drag may start from,
  // checked when the drag itself tries to start.
  const pointerAllowsDrag = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    return combine(
      draggable({
        element: row,
        getInitialData: () => ({ rowId: id }),
        canDrag: () => pointerAllowsDrag.current,
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: row,
        onDragEnter: () => setIsOver(true),
        onDragLeave: () => setIsOver(false),
        onDrop: ({ source }) => {
          setIsOver(false)
          const sourceId = source.data.rowId
          if (typeof sourceId === 'string' && sourceId !== id) {
            onDropOn(sourceId, index)
          }
        },
      }),
    )
  }, [id, index, onDropOn])

  return (
    <li
      ref={el => {
        rowRef.current = el
        itemRef?.(el)
      }}
      tabIndex={0}
      aria-label={label}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onMouseDownCapture={e => {
        pointerAllowsDrag.current = handleOnly
          ? isDragHandle(e.target)
          : !isInteractive(e.target)
      }}
      onKeyDown={e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          e.stopPropagation()
          onKeyMove(id, e.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      className={`relative w-full select-none ${
        handleOnly ? '' : 'cursor-grab active:cursor-grabbing'
      } ${className} ${dragging ? 'opacity-40' : ''} ${
        isOver
          ? 'rounded-lg outline-2 outline-offset-4 outline-indigo-400 outline-dashed'
          : ''
      }`}
    >
      {children}
    </li>
  )
}
