/**
 * One layout, rendered as a real slide and edited on the spot (TMPL-4).
 *
 * This is the whole point of the editor: the thing you look at is the thing
 * you change. It renders through the same SlideView the viewer uses, so a
 * colour or a font size shows as it will on a lecture slide, and lays a thin
 * interaction layer over the top — click a box to select it, drag one that
 * sits in a free container to move or resize it, arrow keys for the same by
 * keyboard.
 *
 * Selection needs no measurement at all: every slot already renders inside a
 * `data-flip-id` wrapper and every tree node carries `data-node-id`, so a
 * single listener on the canvas and `closest()` is enough. That is what lets
 * a box be selected in a flex container, where there is nothing to drag.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LayoutGuides, LayoutNode, Template } from '@slide-machine/shared'
import TemplatePreview from './TemplatePreview'
import CanvasRulers from './CanvasRulers'
import { ARROWS, NUDGE, clampBox, snapBox } from './geometry'
import type { ThemeMetricsLike } from './types'

/** Finds a node and its parent anywhere in a tree. */
export const findNode = (
  root: LayoutNode | undefined,
  id: string,
  parent?: LayoutNode,
): { node: LayoutNode; parent?: LayoutNode } | undefined => {
  if (!root) return undefined
  if (root.id === id) return { node: root, parent }
  for (const child of root.children ?? []) {
    const found = findNode(child, id, root)
    if (found) return found
  }
  return undefined
}

/** Where the renderer draws a freely placed box that has never been placed.
 * Kept in step with FlowLayout's own fallback. */
const UNPLACED = { x: 0.2, y: 0.2, w: 0.6, h: 0.3 }

/** Where a node actually is on screen, as fractions of the canvas — used to
 * start a drag from what the author can see rather than from a guess. */
const measuredBox = (
  canvas: HTMLElement | null,
  id: string,
): { x: number; y: number; w: number; h: number } | undefined => {
  const el = canvas?.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(id)}"]`,
  )
  const frame = canvas?.getBoundingClientRect()
  if (!el || !frame?.width || !frame.height) return undefined
  const r = el.getBoundingClientRect()
  return {
    x: (r.left - frame.left) / frame.width,
    y: (r.top - frame.top) / frame.height,
    w: r.width / frame.width,
    h: r.height / frame.height,
  }
}

/** A tree with one node replaced. Rebuilds the path rather than mutating, so
 * React sees a new tree and undo keeps whole snapshots. */
export const replaceNode = (
  root: LayoutNode,
  id: string,
  patch: (node: LayoutNode) => LayoutNode,
): LayoutNode => {
  if (root.id === id) return patch(root)
  if (!root.children) return root
  return {
    ...root,
    children: root.children.map(child => replaceNode(child, id, patch)),
  }
}

export default function LayoutCanvas({
  template,
  layoutIndex,
  images,
  metrics,
  selectedId,
  hoveredId,
  onSelect,
  onTree,
  onGuides,
  onRecord,
}: {
  /** The draft, so the preview reflects unsaved edits. */
  template: Template
  layoutIndex: number
  images: string[]
  metrics: ThemeMetricsLike
  selectedId: string | null
  /** The box the pointer is over in the outline, lit on the slide. */
  hoveredId?: string | null
  onSelect: (id: string | null) => void
  onTree: (tree: LayoutNode) => void
  onGuides: (guides: LayoutGuides) => void
  onRecord: (key?: string) => void
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const layout = template.layouts[layoutIndex]
  const tree = layout?.tree

  /** Whether a box sits at coordinates of its own, which is what can be
   * dragged. One placed by its container moves by being reordered instead. */
  const isFree = (id: string): boolean => Boolean(findNode(tree, id)?.node.free)

  const setBox = (id: string, box: NonNullable<LayoutNode['box']>) => {
    if (!tree) return
    onTree(replaceNode(tree, id, node => ({ ...node, box })))
  }

  /** Turns a pointer position into a fraction of the canvas. */
  const frame = () => canvasRef.current?.getBoundingClientRect()

  const beginDrag = (
    id: string,
    e: React.PointerEvent,
    mode: 'move' | 'resize',
  ) => {
    const rect = frame()
    const node = findNode(tree, id)?.node
    if (!rect || !node || !rect.width) return
    // A box its container has never placed still drags: it is drawn at the
    // renderer's fallback, so start the gesture from where it is on screen.
    const start = node.box ?? measuredBox(canvasRef.current, id) ?? UNPLACED
    e.preventDefault()
    e.stopPropagation()
    onRecord()
    // Where in the box the pointer took hold, so it does not jump on the
    // first move.
    const grabX = (e.clientX - rect.left) / rect.width - start.x
    const grabY = (e.clientY - rect.top) / rect.height - start.y

    const move = (ev: PointerEvent) => {
      const x = (ev.clientX - rect.left) / rect.width
      const y = (ev.clientY - rect.top) / rect.height
      const next =
        mode === 'move'
          ? { ...start, x: x - grabX, y: y - grabY }
          : { ...start, w: x - start.x, h: y - start.y }
      // Snapping is for the pointer only: an arrow key is the exact route,
      // and snapping it would make the two disagree.
      setBox(id, clampBox(snapBox(next, metrics, layout?.guides)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // On the window, not the element: the pointer leaves the box routinely,
    // and jsdom has no setPointerCapture to lean on.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    const arrow = ARROWS[e.key]
    const box = findNode(tree, id)?.node.box
    if (!arrow || !box) return
    e.preventDefault()
    // One snapshot per run of presses, so holding a key is one undo step.
    onRecord(`nudge:${id}`)
    setBox(
      id,
      clampBox(
        e.shiftKey
          ? { ...box, w: box.w + arrow.dx * NUDGE, h: box.h + arrow.dy * NUDGE }
          : {
              ...box,
              x: box.x + arrow.dx * NUDGE,
              y: box.y + arrow.dy * NUDGE,
            },
      ),
    )
  }

  /**
   * Selection by delegation: the rendered slide already tags every slot and
   * every tree node, so nothing has to be measured or mirrored.
   *
   * A freely placed box also starts moving on the same press. Making someone
   * click to select and then press again to drag would be two gestures for
   * what reads as one.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
    const id = el?.dataset.nodeId ?? null
    onSelect(id)
    if (id && isFree(id)) beginDrag(id, e, 'move')
  }

  if (!layout) return null

  const selectedBox =
    selectedId && isFree(selectedId)
      ? findNode(tree, selectedId)?.node.box
      : undefined

  return (
    <div className="relative mr-4 mb-4">
      {/* Links inside a rendered slide would navigate away from the editor,
          and text selection fights every drag. */}
      <div
        ref={canvasRef}
        onPointerDown={onPointerDown}
        className="relative [&_a]:pointer-events-none select-none"
      >
        <TemplatePreview
          template={template}
          layout={layout}
          images={images}
          interactive
          testId="template-canvas"
        />

        {/* The safe area the template asks for, and the author's own lines. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            outline: '1px dashed rgb(148 163 184 / 0.7)',
            outlineOffset: 0,
            inset: `${metrics.marginY * 100}% ${metrics.marginX * 100}%`,
          }}
        />

        {/* One handle per absolutely placed box. Boxes in a flex or grid
            container are placed by the container, so there is nothing to drag
            — they are selected by clicking and reordered in the outline. */}
        {selectedId && selectedBox && (
          <div
            tabIndex={0}
            aria-label={t('template.boxAt', {
              slot: selectedId,
              x: Math.round(selectedBox.x * 100),
              y: Math.round(selectedBox.y * 100),
              w: Math.round(selectedBox.w * 100),
              h: Math.round(selectedBox.h * 100),
            })}
            onPointerDown={e => beginDrag(selectedId, e, 'move')}
            onKeyDown={onKeyDown(selectedId)}
            className="absolute cursor-move rounded border-2 border-indigo-500 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            style={{
              left: `${selectedBox.x * 100}%`,
              top: `${selectedBox.y * 100}%`,
              width: `${selectedBox.w * 100}%`,
              height: `${selectedBox.h * 100}%`,
            }}
          >
            <span
              aria-hidden
              onPointerDown={e => beginDrag(selectedId, e, 'resize')}
              className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize border-r-2 border-b-2 border-indigo-600"
            />
          </div>
        )}

        {/* A box the container places still shows where it is, so clicking
            one gives the same feedback as clicking a free one. */}
        {selectedId && !selectedBox && (
          <NodeOutline
            canvasRef={canvasRef}
            nodeId={selectedId}
            watch={layout}
          />
        )}

        {/* Pointing at a row in the outline lights the box it names, so the
            list and the slide are never ambiguous about which is which. */}
        {hoveredId && hoveredId !== selectedId && (
          <NodeOutline
            canvasRef={canvasRef}
            nodeId={hoveredId}
            watch={layout}
            muted
          />
        )}
      </div>

      <CanvasRulers
        canvasRef={canvasRef}
        guides={layout.guides}
        onChange={onGuides}
        onRecord={onRecord}
      />
    </div>
  )
}

/**
 * A ring around a node the container placed, rather than one carrying its own
 * box. Where it went is the container's decision, so the answer is read off
 * the DOM — simpler than recomputing it, and always right.
 *
 * Measured in a layout effect rather than during render: the DOM cannot be
 * asked anything while React is still deciding what it should be.
 *
 * The measuring happens again whenever the answer could have changed. Editing
 * a box resizes it — a larger type size, more padding — and a ring left at the
 * old size would say the wrong thing about the very edit being made. `watch`
 * re-runs it on every change to the layout, and a `ResizeObserver` catches
 * what arrives later still: a web font settling, a picture finishing loading.
 */
function NodeOutline({
  canvasRef,
  nodeId,
  watch,
  muted,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  nodeId: string
  /** Anything whose change could move the box. Compared by identity. */
  watch?: unknown
  /** A hover rather than a selection: present, but not the loud one. */
  muted?: boolean
}) {
  const [box, setBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const el = canvas?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    )
    if (!canvas || !el) {
      setBox(null)
      return
    }
    const measure = () => {
      const frame = canvas.getBoundingClientRect()
      if (!frame.width || !frame.height) {
        setBox(null)
        return
      }
      const r = el.getBoundingClientRect()
      setBox({
        left: ((r.left - frame.left) / frame.width) * 100,
        top: ((r.top - frame.top) / frame.height) * 100,
        width: (r.width / frame.width) * 100,
        height: (r.height / frame.height) * 100,
      })
    }
    measure()
    // The box moves when it grows, and also when a sibling does, so both are
    // watched — and the canvas itself, for the window being resized.
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    observer.observe(el)
    for (const sibling of el.parentElement?.children ?? [])
      observer.observe(sibling)
    return () => observer.disconnect()
  }, [canvasRef, nodeId, watch])

  if (!box) return null
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded border-2 ${
        muted ? 'border-indigo-300' : 'border-indigo-500'
      }`}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      }}
    />
  )
}
