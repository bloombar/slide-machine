/**
 * Editing a template you authored (TMPL-4), by looking at it.
 *
 * One layout at a time, rendered as a real slide: pick it from the rail on the
 * left, click a box on the slide to edit it in the column on the right, and
 * change what the whole template shares underneath. What you look at is what
 * you change — the editor used to be a form beside a thumbnail, and the two
 * never quite agreed.
 *
 * A layout is a tree of boxes: flex and grid containers by default, so a
 * design composes instead of being placed coordinate by coordinate, with
 * absolute positioning available per container for the designs that need it —
 * which is what a template imported from Google Slides is (TMPL-8).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Redo2, Undo2 } from 'lucide-react'
import type {
  BoxStyle,
  ContainerSpec,
  Layout,
  LayoutGuides,
  LayoutNode,
  SlotSpec,
  Template,
  TemplateRenderMode,
} from '@slide-machine/shared'
import {
  LAYOUT_TYPES,
  WHITEBOARD_LAYOUT_TYPE,
  defaultLayoutTree,
} from '@slide-machine/shared'
import { themeColors, themeMetrics, themeTextStyles } from '../slide/theme'
import { useUndoRedoKeys } from '../../hooks/useUndoRedoKeys'
import ConfirmDialog from '../ConfirmDialog'
import LayoutRail from './LayoutRail'
import LayoutCanvas, { findNode, replaceNode } from './LayoutCanvas'
import LayoutInspector from './LayoutInspector'
import LayoutTreeOutline from './LayoutTreeOutline'
import SlotInspector, { type ContentType } from './SlotInspector'
import TemplateSettings from './TemplateSettings'
import { flattenLayout } from './flatten'
import { usePreviewImages } from './usePreviewImages'
import { useDraftHistory } from './useDraftHistory'

/** A template that arranges anything absolutely is drawn from its boxes.
 * Derived on save rather than asked about; largely historical now that every
 * layout carries a tree (docs/TEMPLATES.md §4). */
const renderModeOf = (layouts: Layout[]): TemplateRenderMode =>
  layouts.some(l => Object.keys(l.elementPositions ?? {}).length > 0)
    ? 'positioned'
    : 'components'

/**
 * A machine name for a box the author just added. Slide content is stored
 * under this name, so it must be stable and unique within the layout — the
 * label stays theirs to edit, this does not change once set.
 */
const slotNameFrom = (label: string, taken: string[]): string => {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const stem = base || 'box'
  if (!taken.includes(stem)) return stem
  let n = 2
  while (taken.includes(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

/**
 * A layout of the author's own starts with one text box in a stack, since a
 * layout with no boxes holds nothing and cannot be saved. They rename it,
 * change what it holds, or add more from there.
 */
const newLayout = (label: string, taken: string[]): Layout => {
  const type = slotNameFrom(label, taken)
  return {
    type,
    label: label.trim(),
    // Their own words, which the AI reads when choosing a layout (TMPL-6).
    purpose: label.trim(),
    slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
    tree: {
      id: 'root',
      container: {
        mode: 'flex',
        direction: 'column',
        justify: 'center',
        gap: 3,
      },
      style: { paddingX: 6 },
      children: [
        { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
      ],
    },
    elementPositions: {},
  }
}

/** Everything undo restores. The selection is part of it: undoing a deletion
 * that leaves nothing selected is disorienting. */
interface Draft {
  name: string
  theme: Record<string, unknown>
  layouts: Layout[]
  visibility: Template['visibility']
  layoutIndex: number
  selectedId: string | null
}

/** A node id that is not already in the tree. */
const freeId = (tree: LayoutNode | undefined, stem: string): string => {
  if (!findNode(tree, stem)) return stem
  let n = 2
  while (findNode(tree, `${stem}-${n}`)) n++
  return `${stem}-${n}`
}

/** A tree with one node's children replaced. */
const withChildren = (
  root: LayoutNode,
  parentId: string,
  next: (children: LayoutNode[]) => LayoutNode[],
): LayoutNode =>
  replaceNode(root, parentId, node => ({
    ...node,
    children: next(node.children ?? []),
  }))

/**
 * The nearest layout the editor can actually show, starting from `wanted`.
 *
 * Every template keeps a whiteboard and it is never listed, so an index may
 * point at one — most easily after deleting the layout in front of it. Looks
 * forward first, so deleting a layout lands on the next one rather than
 * jumping backwards.
 */
const editableIndex = (layouts: Layout[], wanted: number): number => {
  const editable = (i: number) =>
    i >= 0 && i < layouts.length && layouts[i]?.type !== WHITEBOARD_LAYOUT_TYPE
  const from = Math.max(0, Math.min(wanted, layouts.length - 1))
  for (let i = from; i < layouts.length; i++) if (editable(i)) return i
  for (let i = from - 1; i >= 0; i--) if (editable(i)) return i
  return from
}

/**
 * An equal share of the space a row or column has to give out.
 *
 * `grow: 1` alone only shares out what is *left over* after every box has
 * taken its content's width, which is not an even division of anything.
 * Starting them all from nothing is what makes the shares equal.
 */
const EVEN_SHARE = { grow: 1, basis: 0 }

/**
 * Sets a row or column's boxes to divide it evenly, which is what someone
 * making one almost always means by it.
 *
 * A default rather than a rule: it is written onto the boxes, so it shows in
 * their own settings and can be changed there. Boxes that already say how
 * much room they take are left alone.
 */
const shareEvenly = (children: LayoutNode[]): LayoutNode[] =>
  children.map(child =>
    child.grow === undefined && child.basis === undefined
      ? { ...child, ...EVEN_SHARE }
      : child,
  )

/** A tree without one node. */
const removeNode = (root: LayoutNode, id: string): LayoutNode => ({
  ...root,
  children: (root.children ?? [])
    .filter(child => child.id !== id)
    .map(child => removeNode(child, id)),
})

export default function TemplateEditor({
  template,
  layoutSources,
  onSave,
  onCancel,
  onDirtyChange,
  saveRef,
  saving,
  error,
}: {
  template: Template
  /** Templates to lift a layout definition from when one is added. Copying an
   * existing definition keeps slot sets out of code, so a deployment that
   * ships its own layouts is what defines them. */
  layoutSources: Template[]
  onSave: (draft: {
    name: string
    renderMode: TemplateRenderMode
    theme: Record<string, unknown>
    layouts: Layout[]
    visibility: Template['visibility']
  }) => Promise<boolean>
  onCancel: () => void
  /** Reports unsaved work, so the surface around the editor can refuse to
   * throw it away without asking. */
  onDirtyChange?: (dirty: boolean) => void
  /** Filled with this editor's save, so the surface around it can offer to
   * save rather than only to discard. */
  saveRef?: React.RefObject<(() => Promise<boolean>) | null>
  saving?: boolean
  error?: string | null
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(template.name)
  const [theme, setTheme] = useState<Record<string, unknown>>(template.theme)
  const [layouts, setLayouts] = useState<Layout[]>(template.layouts)
  const [visibility, setVisibility] = useState(template.visibility)
  const [layoutIndex, setLayoutIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /** The layout the rail asked to delete, until the author says yes. */
  const [confirmLayout, setConfirmLayout] = useState<number | null>(null)
  const canvasHost = useRef<HTMLDivElement>(null)

  /**
   * Adopts a newly saved template as the draft.
   *
   * Saving measures the drawn geometry into every layout, so what comes back
   * is not quite what was sent — enough to keep reading as unsaved work on a
   * surface that stays open afterwards. Which layout is on screen and what
   * undo can reach are left alone: nothing about them changed.
   */
  const adopted = useRef(template)
  useEffect(() => {
    if (adopted.current === template) return
    adopted.current = template
    setName(template.name)
    setTheme(template.theme)
    setLayouts(template.layouts)
    setVisibility(template.visibility)
  }, [template])

  const images = usePreviewImages()
  const metrics = themeMetrics(theme)
  const textStyles = themeTextStyles(theme)
  // Which layout is on screen, never the whiteboard: it is stored on every
  // template but kept out of the rail (TMPL-7), so an index that lands on it
  // — after a delete, or on a template whose first layout it is — would show
  // a blank slate with nothing to edit and no tab marked selected.
  const shownIndex = editableIndex(layouts, layoutIndex)
  const layout = layouts[shownIndex]
  // The layout the confirmation is about, paired with where it sits.
  const asked = confirmLayout === null ? undefined : layouts[confirmLayout]
  const pending =
    asked && confirmLayout !== null
      ? { index: confirmLayout, layout: asked }
      : null

  const snapshot = useCallback(
    (): Draft => ({
      name,
      theme,
      layouts,
      visibility,
      layoutIndex,
      selectedId,
    }),
    [name, theme, layouts, visibility, layoutIndex, selectedId],
  )
  const restore = useCallback((d: Draft) => {
    setName(d.name)
    setTheme(d.theme)
    setLayouts(d.layouts)
    setVisibility(d.visibility)
    setLayoutIndex(d.layoutIndex)
    setSelectedId(d.selectedId)
  }, [])
  const history = useDraftHistory(snapshot, restore)
  // The hook already ignores presses inside a text field, so a box label's own
  // undo keeps working, and returns false on an empty stack so the browser's
  // Cmd-Z is left alone.
  useUndoRedoKeys(history.undo, history.redo, true)

  const setLayout = (index: number, patch: Partial<Layout>) =>
    setLayouts(prev =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    )

  const setTree = (tree: LayoutNode) => setLayout(shownIndex, { tree })

  /** Conventional types this template does not have yet, and that some
   * template in the library can supply a definition for. */
  const addable = LAYOUT_TYPES.filter(
    type =>
      !layouts.some(l => l.type === type) &&
      layoutSources.some(s => s.layouts.some(l => l.type === type)),
  )

  const addLayoutOfType = (type: string) => {
    for (const source of layoutSources) {
      const found = source.layouts.find(l => l.type === type)
      if (!found) continue
      history.record()
      const copy = structuredClone(found)
      copy.tree ??= defaultLayoutTree(type)
      setLayouts(prev => [...prev, copy])
      setLayoutIndex(layouts.length)
      setSelectedId(null)
      return
    }
  }

  /** Adds a layout of the author's own, named for its place in the list.
   * Renaming it is the first thing they can do; making them name it before
   * seeing anything would put a form in front of a design (TMPL-9). */
  const addOwnLayout = () => {
    history.record()
    const shown = layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE).length
    const label = t('template.layoutNumbered', { number: shown + 1 })
    setLayouts(prev => [
      ...prev,
      newLayout(
        label,
        prev.map(l => l.type),
      ),
    ])
    setLayoutIndex(layouts.length)
    setSelectedId(null)
  }

  /** Removes a layout — any of them, since the rail can ask about a layout
   * that is not the one on screen. */
  const deleteLayout = (index: number) => {
    history.record()
    const remaining = layouts.filter((_, i) => i !== index)
    setLayouts(remaining)
    // Stay on the layout being looked at, which has shifted down one if the
    // deleted one was before it. Deleting the one on screen lands on what
    // took its place, or on the one before it if it was the last.
    setLayoutIndex(
      editableIndex(
        remaining,
        index < shownIndex ? shownIndex - 1 : shownIndex,
      ),
    )
    // The selection belongs to the layout it was made in; it only survives if
    // that layout does.
    if (index === shownIndex) setSelectedId(null)
    setConfirmLayout(null)
  }

  const selected = layout?.tree
    ? findNode(layout.tree, selectedId ?? '')
    : undefined
  const selectedSpec = selected?.node.slot
    ? layout?.slots.find(s => s.name === selected.node.slot)
    : undefined
  const siblings = selected?.parent?.children ?? []
  const selectedAt = siblings.findIndex(c => c.id === selectedId)

  /** Adds a box inside a container, with a slot of its own so it can hold
   * something. */
  const addBox = (parentId: string) => {
    if (!layout?.tree) return
    history.record()
    const label = t('template.newBoxName')
    const slotName = slotNameFrom(
      label,
      layout.slots.map(s => s.name),
    )
    const id = freeId(layout.tree, slotName)
    // Joining a row whose boxes divide it evenly means taking a share of it,
    // not squeezing in beside them — and the first box into an empty row is
    // the one that starts the division. A layout that sizes its boxes some
    // other way, as the built-ins do, is left to keep doing so.
    const parent = findNode(layout.tree, parentId)?.node
    const siblings = parent?.children ?? []
    const shares =
      parent?.container?.mode === 'flex' &&
      siblings.every(c => c.grow !== undefined || c.basis !== undefined)
    setLayout(shownIndex, {
      slots: [...layout.slots, { name: slotName, kind: 'text', label }],
      tree: withChildren(layout.tree, parentId, children => [
        ...children,
        {
          id,
          slot: slotName,
          style: { textStyle: 'body' },
          ...(shares ? EVEN_SHARE : {}),
        },
      ]),
    })
    setSelectedId(id)
  }

  /** Moves a box among its siblings. That order is the flow in a flex or grid
   * container, and the paint order in a free one — the same edit either way. */
  const moveBox = (id: string, delta: number) => {
    if (!layout?.tree) return
    const found = findNode(layout.tree, id)
    if (!found?.parent) return
    history.record()
    setTree(
      withChildren(layout.tree, found.parent.id, children => {
        const from = children.findIndex(c => c.id === id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= children.length) return children
        const next = [...children]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        return next
      }),
    )
  }

  /** A box dropped onto another takes its place. Only among siblings: dropping
   * a box into a different container would change what contains it, which is
   * a different edit from reordering and is not what a list drag means. */
  const dropBoxOn = (sourceId: string, targetId: string) => {
    if (!layout?.tree || sourceId === targetId) return
    const from = findNode(layout.tree, sourceId)
    const onto = findNode(layout.tree, targetId)
    if (!from?.parent || from.parent.id !== onto?.parent?.id) return
    history.record()
    setTree(
      withChildren(layout.tree, from.parent.id, children => {
        const at = children.findIndex(c => c.id === sourceId)
        const to = children.findIndex(c => c.id === targetId)
        if (at < 0 || to < 0) return children
        const next = [...children]
        const [moved] = next.splice(at, 1)
        next.splice(to, 0, moved!)
        return next
      }),
    )
  }

  /**
   * Removes a box, and everything it held with it: a container's children
   * have nothing left to arrange them, so their slots go too. One undo away,
   * which is why nothing asks first.
   */
  const deleteBox = (id: string) => {
    if (!layout?.tree) return
    const found = findNode(layout.tree, id)
    // The root is the layout itself, which is deleted from the rail.
    if (!found?.parent) return
    history.record()
    const gone = new Set<string>()
    const collect = (node: LayoutNode) => {
      if (node.slot) gone.add(node.slot)
      for (const child of node.children ?? []) collect(child)
    }
    collect(found.node)
    const tree = removeNode(layout.tree, id)
    setLayout(shownIndex, {
      tree,
      slots: layout.slots.filter(s => !gone.has(s.name)),
    })
    // Whatever was selected inside it went with it.
    if (selectedId && !findNode(tree, selectedId)) setSelectedId(null)
  }

  const patchNode = (patch: Partial<LayoutNode>) => {
    if (!layout?.tree || !selectedId) return
    setTree(
      replaceNode(layout.tree, selectedId, node => ({ ...node, ...patch })),
    )
  }

  const patchStyle = (patch: Partial<BoxStyle>) => {
    if (!layout?.tree || !selectedId) return
    setTree(
      replaceNode(layout.tree, selectedId, node => ({
        ...node,
        style: { ...node.style, ...patch },
      })),
    )
  }

  const patchSpec = (patch: Partial<SlotSpec>) => {
    if (!layout || !selectedSpec) return
    setLayout(shownIndex, {
      slots: layout.slots.map(s =>
        s.name === selectedSpec.name ? { ...s, ...patch } : s,
      ),
    })
  }

  const patchContainer = (patch: Partial<ContainerSpec>) => {
    if (!layout?.tree || !selectedId) return
    setTree(
      replaceNode(layout.tree, selectedId, node => ({
        ...node,
        container: { mode: 'flex', ...node.container, ...patch },
      })),
    )
  }

  /**
   * Changes what a box is: content of some kind, or an arrangement of other
   * boxes.
   *
   * The two are exclusive — a box either shows something or organises things
   * that do — so switching drops what the other side needed. Becoming an
   * arrangement gives up the slot it was showing; becoming content gives up
   * the boxes it held, and their slots with them. Both are one undo away.
   */
  const setContentType = (next: ContentType) => {
    if (!layout?.tree || !selectedId) return
    const found = findNode(layout.tree, selectedId)
    if (!found) return
    history.record()
    const { node } = found

    if (next === 'column' || next === 'row' || next === 'grid') {
      const container: ContainerSpec =
        next === 'grid'
          ? {
              ...node.container,
              mode: 'grid',
              columns: node.container?.columns ?? 2,
            }
          : { ...node.container, mode: 'flex', direction: next }
      setLayout(shownIndex, {
        // The slot it showed has no box left to appear in.
        slots: node.slot
          ? layout.slots.filter(s => s.name !== node.slot)
          : layout.slots,
        tree: replaceNode(layout.tree, selectedId, n => ({
          ...n,
          slot: undefined,
          before: undefined,
          after: undefined,
          container,
          // A grid already divides itself into equal tracks; a row or column
          // has to be told to.
          children:
            container.mode === 'flex'
              ? shareEvenly(n.children ?? [])
              : (n.children ?? []),
        })),
      })
      return
    }

    // Back to content: whatever it arranged goes with it, since nothing is
    // left to arrange those boxes.
    const orphaned = new Set<string>()
    const collect = (n: LayoutNode) => {
      if (n.slot) orphaned.add(n.slot)
      for (const child of n.children ?? []) collect(child)
    }
    for (const child of node.children ?? []) collect(child)

    const name =
      node.slot ??
      slotNameFrom(
        t('template.newBoxName'),
        layout.slots.map(s => s.name),
      )
    const slots = layout.slots.filter(s => !orphaned.has(s.name))
    setLayout(shownIndex, {
      slots: slots.some(s => s.name === name)
        ? slots.map(s => (s.name === name ? { ...s, kind: next } : s))
        : [...slots, { name, kind: next, label: t('template.newBoxName') }],
      tree: replaceNode(layout.tree, selectedId, n => ({
        ...n,
        container: undefined,
        children: undefined,
        slot: name,
      })),
    })
  }

  /**
   * Whether the draft differs from the template that was opened.
   *
   * Compared rather than tracked: a snapshot is taken whenever a field is
   * focused, so "has anything been recorded" would count merely looking at a
   * box as an edit. A template is a few kilobytes, so this is cheap.
   */
  const dirty =
    JSON.stringify({ name, theme, layouts, visibility }) !==
    JSON.stringify({
      name: template.name,
      theme: template.theme,
      layouts: template.layouts,
      visibility: template.visibility,
    })

  useEffect(() => {
    onDirtyChange?.(dirty)
    // Closing the editor leaves nothing to lose, whatever it held.
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  // The preview reflects the draft, so a colour change is visible before it
  // is saved rather than after.
  const draft: Template = { ...template, name, theme, layouts, visibility }

  /**
   * Saving measures what the browser drew and writes it into each layout's
   * geometry, because the PDF, pptx and Slides exporters cannot run CSS. Only
   * the layout on screen can be measured; the rest keep the geometry they had
   * rather than losing it.
   */
  const save = (): Promise<boolean> => {
    const canvas = canvasHost.current
    const colors = themeColors(theme)
    const flattened = layouts.map((l, i) =>
      i === shownIndex
        ? flattenLayout(canvas, l, `preview-${template.id}`, colors)
        : l,
    )
    return onSave({
      name,
      renderMode: renderModeOf(flattened),
      theme,
      layouts: flattened,
      visibility,
    })
  }

  useEffect(() => {
    if (saveRef) saveRef.current = save
  })

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <LayoutRail
          layouts={layouts}
          selected={shownIndex}
          onSelect={i => {
            setLayoutIndex(i)
            setSelectedId(null)
          }}
          onDelete={setConfirmLayout}
          addable={[...addable]}
          onAddType={addLayoutOfType}
          onAddOwn={addOwnLayout}
        />

        <div ref={canvasHost} className="min-w-0 flex-1">
          {layout && (
            <LayoutCanvas
              template={draft}
              layoutIndex={shownIndex}
              images={images}
              metrics={metrics}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={setSelectedId}
              onTree={setTree}
              onGuides={(guides: LayoutGuides) =>
                setLayout(shownIndex, { guides })
              }
              onRecord={history.record}
            />
          )}
        </div>

        {/* The list of boxes first, then whatever is selected: the column
            reads as "which one" above "and what about it", and the settings'
            own destructive action stays the last thing in it. */}
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
          {layout?.tree && layout.type !== WHITEBOARD_LAYOUT_TYPE && (
            <LayoutTreeOutline
              tree={layout.tree}
              specs={layout.slots}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onHover={setHoveredId}
              onMove={moveBox}
              onDropOn={dropBoxOn}
              onAddChild={addBox}
              onDelete={deleteBox}
            />
          )}

          {layout &&
            (selected && selectedId ? (
              <SlotInspector
                node={selected.node}
                spec={selectedSpec}
                parent={selected.parent?.container}
                canMoveEarlier={selectedAt > 0}
                canMoveLater={
                  selectedAt >= 0 && selectedAt < siblings.length - 1
                }
                onNode={patchNode}
                onStyle={patchStyle}
                onSpec={patchSpec}
                onContentType={setContentType}
                onContainer={patchContainer}
                onReorder={delta => moveBox(selectedId, delta)}
                onClose={() => setSelectedId(null)}
                onRecord={history.record}
                textStyles={textStyles}
              />
            ) : (
              <LayoutInspector
                layout={layout}
                onChange={patch => setLayout(shownIndex, patch)}
                onRecord={history.record}
              />
            ))}
        </div>
      </div>

      <TemplateSettings
        name={name}
        visibility={visibility}
        theme={theme}
        onName={setName}
        onVisibility={setVisibility}
        onTheme={patch => setTheme(prev => ({ ...prev, ...patch }))}
        onRecord={history.record}
      />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Pinned to the bottom of the screen. The editor is taller than the
          screen — a Save that scrolls away is a Save that gets missed, and
          nothing here writes anything by itself.

          `bottom-8` clears the app's own sticky status footer (h-8), so the
          two stack rather than overlap, and the shared z-30 keeps this bar
          over the page it floats above without reaching a dialog (z-40). */}
      <div
        data-testid="template-editor-actions"
        className="sticky bottom-8 z-30 -mx-6 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur"
      >
        {/* The keyboard must not be the only route to undo. */}
        <button
          type="button"
          onClick={history.undo}
          disabled={!history.canUndo}
          aria-label={t('common.undo')}
          title={t('common.undo')}
          className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={history.redo}
          disabled={!history.canRedo}
          aria-label={t('common.redo')}
          title={t('common.redo')}
          className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Redo2 className="h-4 w-4" aria-hidden />
        </button>
        {/* Says plainly that closing now would lose something. */}
        <span className="mr-auto text-xs text-amber-700">
          {dirty ? t('template.unsaved') : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>

      {/* A layout is a whole design, and deleting one takes the boxes and
          settings in it: worth a question, unlike a single box. */}
      {pending && (
        <ConfirmDialog
          title={t('template.removeLayout', { name: pending.layout.label })}
          message={t('template.removeLayoutConfirm', {
            name: pending.layout.label,
          })}
          confirmLabel={t('common.delete')}
          onConfirm={() => deleteLayout(pending.index)}
          onCancel={() => setConfirmLayout(null)}
        />
      )}
    </form>
  )
}
