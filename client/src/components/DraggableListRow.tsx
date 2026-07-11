/**
 * Reorderable list row where the whole row is the drag surface,
 * generalizable to any vertical list. Pointer dragging comes from
 * Atlassian's pragmatic-drag-and-drop (each row is both draggable and a
 * drop target). Drags never start from interactive or editable elements
 * inside the row, so click-to-edit keeps working; Alt+ArrowUp/Down on
 * the focused row is the keyboard path.
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
  children: ReactNode
}

export default function DraggableListRow({
  id,
  index,
  label,
  onDropOn,
  onKeyMove,
  itemRef,
  children,
}: Props) {
  const rowRef = useRef<HTMLLIElement | null>(null)
  // Where the pointer went down, checked when the drag tries to start
  const pointerOnInteractive = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    return combine(
      draggable({
        element: row,
        getInitialData: () => ({ rowId: id }),
        canDrag: () => !pointerOnInteractive.current,
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
        pointerOnInteractive.current = isInteractive(e.target)
      }}
      onKeyDown={e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          e.stopPropagation()
          onKeyMove(id, e.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      className={`relative w-full cursor-grab select-none active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      } ${
        isOver
          ? 'rounded-lg outline-2 outline-offset-4 outline-indigo-400 outline-dashed'
          : ''
      }`}
    >
      {children}
    </li>
  )
}
