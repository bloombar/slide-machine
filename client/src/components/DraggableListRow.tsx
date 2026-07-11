/**
 * Reorderable list row with a drag handle on the left, generalizable to
 * any vertical list. Pointer dragging comes from Atlassian's
 * pragmatic-drag-and-drop (each row is both draggable-by-handle and a
 * drop target); Alt+ArrowUp/Down on the handle is the keyboard path.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'

interface Props {
  /** Stable identity carried through the drag. */
  id: string
  index: number
  handleLabel: string
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
  handleLabel,
  onDropOn,
  onKeyMove,
  itemRef,
  children,
}: Props) {
  const rowRef = useRef<HTMLLIElement | null>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const row = rowRef.current
    const handle = handleRef.current
    if (!row || !handle) return
    return combine(
      draggable({
        element: row,
        dragHandle: handle,
        getInitialData: () => ({ rowId: id }),
        // Drag preview shows only the row's content (the slide), not the
        // whole row — otherwise the ghost includes the handle gutter and
        // its shadow box extends past the slide
        onGenerateDragPreview: ({ nativeSetDragImage, location }) => {
          const content = contentRef.current
          if (!content || !nativeSetDragImage) return
          const rect = content.getBoundingClientRect()
          const { clientX, clientY } = location.initial.input
          nativeSetDragImage(
            content,
            Math.max(16, clientX - rect.x),
            Math.min(rect.height - 16, Math.max(16, clientY - rect.y)),
          )
        },
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
      className={`flex items-center gap-2 ${dragging ? 'opacity-40' : ''} ${
        isOver
          ? 'rounded-lg outline-2 outline-offset-4 outline-indigo-400 outline-dashed'
          : ''
      }`}
    >
      {/* Native <button> handle, matching Atlassian's own DragHandleButton.
          Do not wrap in components that cancel mousedown — that kills the
          native drag before it starts */}
      <button
        ref={handleRef}
        aria-label={handleLabel}
        title={`Drag to reorder (or Alt+↑/↓)`}
        onKeyDown={e => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            e.stopPropagation()
            onKeyMove(id, e.key === 'ArrowUp' ? -1 : 1)
          }
        }}
        className="inline-block cursor-grab rounded-md p-2 text-slate-400 select-none hover:text-slate-900 active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" aria-hidden />
      </button>
      <div ref={contentRef} className="relative min-w-0 flex-1">
        {children}
      </div>
    </li>
  )
}
