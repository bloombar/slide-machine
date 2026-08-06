/**
 * The boxes of one layout as a list, under the preview's right column.
 *
 * Clicking the slide is the usual way to select a box, but a box nested
 * inside two containers is small and easily missed, and one that is empty has
 * nothing to click at all. The outline is the reliable route: everything the
 * layout contains, in the order it is painted. Hovering a row lights the
 * matching box on the slide, so the two views are never ambiguous.
 *
 * Each row carries what can be done to that box: adding one inside it, and
 * deleting it. Deleting asks nothing first — the row is right there under the
 * pointer, and undo takes it back.
 *
 * It is also where boxes are reordered — a whole row is the drag surface, the
 * same as reordering slides (DraggableListRow), with Alt+arrows as the
 * keyboard path. In a flex or grid container that order is the flow; in a
 * free one it is the paint order, which is what "bring forward" means.
 */
import { useTranslation } from 'react-i18next'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import type { LayoutNode, SlotSpec } from '@slide-machine/shared'
import DraggableListRow from '../DraggableListRow'

/** A node flattened for display, with how deep it sits. */
interface Row {
  node: LayoutNode
  depth: number
  parentId?: string
  index: number
}

const flatten = (
  node: LayoutNode,
  depth = 0,
  parentId?: string,
  index = 0,
  into: Row[] = [],
): Row[] => {
  into.push({ node, depth, parentId, index })
  const children = node.children ?? []
  children.forEach((child, i) => flatten(child, depth + 1, node.id, i, into))
  return into
}

/**
 * What to call a box in the list: the slot's label if it shows one, else what
 * kind of container it is, else that it is decoration.
 *
 * A container gets its short name — "Row", "Column", "Grid" — rather than the
 * sentence the mode dropdown uses. A list wants a noun; the dropdown was
 * explaining a choice.
 */
const nameOf = (
  node: LayoutNode,
  specs: SlotSpec[],
  t: (k: string) => string,
): string => {
  if (node.slot)
    return specs.find(s => s.name === node.slot)?.label ?? node.slot
  const container = node.container
  if (!container) return t('template.decoration')
  if (container.mode !== 'flex')
    return t(`template.containerNames.${container.mode}`)
  // A flex container is a row or a column, and which one is the useful thing
  // to say about it.
  return t(
    `template.containerNames.${container.direction === 'row' ? 'row' : 'column'}`,
  )
}

export default function LayoutTreeOutline({
  tree,
  specs,
  selectedId,
  onSelect,
  onHover,
  onMove,
  onDropOn,
  onAddChild,
  onDelete,
}: {
  tree: LayoutNode
  specs: SlotSpec[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Lights the matching box on the slide; null when the pointer leaves. */
  onHover: (id: string | null) => void
  /** The keyboard path: one step among its siblings. */
  onMove: (id: string, delta: -1 | 1) => void
  /** A row dropped onto another: put it at that row's place. */
  onDropOn: (sourceId: string, targetId: string) => void
  onAddChild: (parentId: string) => void
  /** Deletes a box outright. No confirmation: a box is one undo away, and
   * asking about every one of them would be in the way of designing. */
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const rows = flatten(tree)

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-slate-700">
        {t('template.outline')}
      </h4>
      <ul className="flex flex-col" onPointerLeave={() => onHover(null)}>
        {rows.map(({ node, depth, parentId, index }) => {
          const label = nameOf(node, specs, t)
          // The root is the layout itself: it has no siblings to move among.
          const movable = Boolean(parentId)
          const row = (
            // The whole row selects and the whole row drags. The name is
            // plain text rather than a button on purpose: a drag never
            // starts from a control, so making the label one would leave the
            // grip as the only place a row could be picked up from.
            <div
              onPointerEnter={() => onHover(node.id)}
              onClick={() => onSelect(node.id)}
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                onSelect(node.id)
              }}
              aria-current={node.id === selectedId}
              className={`group flex cursor-pointer items-center gap-1 rounded ${
                node.id === selectedId ? 'bg-indigo-50' : 'hover:bg-slate-50'
              }`}
              style={{ paddingLeft: `${depth * 0.75}rem` }}
            >
              {movable ? (
                <GripVertical
                  aria-hidden
                  className="h-3 w-3 shrink-0 text-slate-300"
                />
              ) : (
                <span aria-hidden className="w-3 shrink-0" />
              )}
              <span
                className={`min-w-0 flex-1 truncate px-1 py-1 text-left text-xs ${
                  node.id === selectedId
                    ? 'font-medium text-indigo-700'
                    : 'text-slate-600'
                }`}
              >
                {label}
              </span>
              {node.container && (
                <button
                  type="button"
                  // The row selects on click, so this must not also count as
                  // clicking the row — the new box is what should end up
                  // selected, not the thing it was added to.
                  onClick={e => {
                    e.stopPropagation()
                    onAddChild(node.id)
                  }}
                  aria-label={t('template.addBoxTo', { name: label })}
                  title={t('template.addBoxTo', { name: label })}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                </button>
              )}
              {/* The root is the layout itself, which the rail deletes; only
                  the boxes in it go from here. Hidden until the row is
                  pointed at, and brought back for the keyboard, which never
                  hovers anything. */}
              {movable && (
                <button
                  type="button"
                  // Deleting must not first select the row it is deleting.
                  onClick={e => {
                    e.stopPropagation()
                    onDelete(node.id)
                  }}
                  aria-label={t('template.removeBox', { name: label })}
                  title={t('template.removeBox', { name: label })}
                  className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-red-700 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          )

          // The root cannot be dragged anywhere, so it is a plain row rather
          // than one that advertises a gesture it will not honour.
          return movable ? (
            <DraggableListRow
              key={node.id}
              id={node.id}
              index={index}
              label={t('template.boxRow', { name: label })}
              onDropOn={sourceId => onDropOn(sourceId, node.id)}
              onKeyMove={(id, delta) => onMove(id, delta)}
            >
              {row}
            </DraggableListRow>
          ) : (
            <li key={node.id}>{row}</li>
          )
        })}
      </ul>
    </div>
  )
}
