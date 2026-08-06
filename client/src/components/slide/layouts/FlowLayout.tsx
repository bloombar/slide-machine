/**
 * The layout engine (TMPL-4): draws a layout from its tree.
 *
 * A layout used to be React code — a component per type deciding that the
 * title sits across the top and the image fills the right. Users cannot write
 * components, so a layout is now *data*: a tree of containers and boxes, and
 * this turns that data into DOM. One renderer, any design, and the same one
 * the built-ins use, so nothing an author can build is second class.
 *
 * A container arranges its children in a row or column (`flex`) or in a grid
 * (`grid`), and a child's placement comes from its parent's choice.
 *
 * Any box may set `free` on itself instead: it is then placed at its own
 * coordinates and takes no room from its siblings. Per box rather than per
 * container, so one thing can be put exactly where an author wants it without
 * wrapping it in anything or giving up the arrangement around it.
 *
 * ## Why classes are looked up, never interpolated
 *
 * Tailwind compiles by scanning source text, so `grid-cols-${n}` and
 * `gap-[${v}cqi]` produce classes that exist in dev and vanish in a
 * production build. Every fixed choice here therefore maps through a literal
 * lookup, and everything numeric becomes an inline style.
 */
import type { CSSProperties, ReactNode } from 'react'
import type {
  BoxStyle,
  ContainerSpec,
  LayoutNode,
  SlotKind,
} from '@slide-machine/shared'
import { tierOf } from '@slide-machine/shared'
import type { ThemeColors, ThemeMetrics, ThemeTextStyles } from '../theme'
import type { LayoutProps } from './types'
import { resolveStyle, contentStyle, surfaceStyle } from './boxStyle'
import { slotIsShown } from './slotState'

/** Literal classes, because Tailwind cannot see an interpolated one. */
const DIRECTION: Record<string, string> = {
  row: 'flex-row',
  column: 'flex-col',
}

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
}

/** Grid places items within their cell instead of distributing them, so the
 * distribution values have no grid equivalent and fall back to stretch — the
 * CSS default, and what a box filling its column looks like. */
const JUSTIFY_ITEMS: Record<string, string> = {
  start: 'justify-items-start',
  center: 'justify-items-center',
  end: 'justify-items-end',
  between: 'justify-items-stretch',
  around: 'justify-items-stretch',
  evenly: 'justify-items-stretch',
}

const ALIGN_ITEMS: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
}

/** The classes a container needs. Layout-affecting choices only — anything
 * with a number in it goes through `containerStyle` instead. */
const containerClass = (spec: ContainerSpec): string => {
  // Always a positioning context: any child may lift itself out of the flow,
  // and it should land against the box that contains it rather than the slide.
  if (spec.mode === 'grid')
    return [
      'relative',
      'grid',
      // Unset means stretch: a box with no opinion fills its column, which is
      // what a two-column layout is.
      spec.justify ? JUSTIFY_ITEMS[spec.justify] : 'justify-items-stretch',
      ALIGN_ITEMS[spec.alignItems ?? 'stretch'],
    ]
      .filter(Boolean)
      .join(' ')
  return [
    'flex',
    DIRECTION[spec.direction ?? 'column'],
    JUSTIFY[spec.justify ?? 'start'],
    ALIGN_ITEMS[spec.alignItems ?? 'stretch'],
    spec.wrap ? 'flex-wrap' : 'flex-nowrap',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Gaps and track counts: numbers, so inline styles. `cqi` throughout, so a
 * gap is the same fraction of the slide at any render size. */
const containerStyle = (spec: ContainerSpec): CSSProperties => {
  const style: CSSProperties = {}
  if (spec.gap !== undefined) style.gap = `${spec.gap}cqi`
  if (spec.gapX !== undefined) style.columnGap = `${spec.gapX}cqi`
  if (spec.gapY !== undefined) style.rowGap = `${spec.gapY}cqi`
  if (spec.mode === 'grid') {
    if (spec.columns)
      style.gridTemplateColumns = `repeat(${spec.columns}, minmax(0, 1fr))`
    if (spec.rows)
      style.gridTemplateRows = `repeat(${spec.rows}, minmax(0, 1fr))`
  }
  return style
}

/** Where a box that has opted out of the flow sits before it has been put
 * anywhere: middle of the slide, big enough to see and to grab. */
const FALLBACK_BOX = { x: 0.2, y: 0.2, w: 0.6, h: 0.3 }

/**
 * Which element a box is, taken from the named text style it follows.
 *
 * A slide's title is a heading, and was an `<h1>` when layouts were
 * components — losing that would leave a screen reader with a wall of
 * undifferentiated text and no way to skim a deck. The style already names
 * what the text *is*, so it is the right thing to read this from: nothing
 * extra to declare, and a box set to "Lecture title" becomes one.
 */
const ELEMENT_FOR: Record<string, 'h1' | 'h2'> = {
  title: 'h1',
  sectionTitle: 'h2',
  heading: 'h2',
}

/**
 * How a node sits in its parent: at its own coordinates if it is `free`, and
 * otherwise wherever the container puts it. Nothing reads both, which is what
 * keeps the two models in one tree.
 */
const placementStyle = (
  node: LayoutNode,
  parent: ContainerSpec | undefined,
): CSSProperties => {
  // The root has no parent to be placed by: it is the slide.
  if (!parent) return { width: '100%', height: '100%' }
  if (node.free) {
    // A box with nowhere to be yet still has to be somewhere, or opting out
    // of the flow would make it vanish rather than let it be dragged.
    const box = node.box ?? FALLBACK_BOX
    return {
      position: 'absolute',
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.w * 100}%`,
      height: `${box.h * 100}%`,
    }
  }
  const style: CSSProperties = {}
  if (node.grow !== undefined) style.flexGrow = node.grow
  if (node.shrink !== undefined) style.flexShrink = node.shrink
  if (node.basis !== undefined) style.flexBasis = `${node.basis * 100}%`
  if (node.width !== undefined) style.width = `${node.width * 100}%`
  if (node.height !== undefined) style.height = `${node.height * 100}%`
  if (node.colSpan)
    style.gridColumn = `span ${node.colSpan} / span ${node.colSpan}`
  if (node.rowSpan)
    style.gridRow = `span ${node.rowSpan} / span ${node.rowSpan}`
  // A flow child with nothing to say still must not overflow its track.
  style.minWidth = 0
  style.minHeight = 0
  return style
}

function Node({
  node,
  parent,
  colors,
  textStyles,
  shows,
  kindOf,
  slot,
}: {
  node: LayoutNode
  parent?: ContainerSpec
  colors: ThemeColors
  textStyles: ThemeTextStyles
  /** Whether a named slot earns space on this slide. */
  shows: (slot: string) => boolean
  /** What medium a named slot holds, for the transition's box matching. */
  kindOf: (slot: string) => SlotKind
  slot: (name: string) => ReactNode
}) {
  const style: BoxStyle = resolveStyle(node.style, textStyles)
  const placement = placementStyle(node, parent)

  // A container: draw the box, then let it arrange its children.
  if (node.container) {
    const spec = node.container
    return (
      <div
        data-node-id={node.id}
        className={containerClass(spec)}
        style={{
          ...placement,
          ...surfaceStyle(style, colors),
          ...containerStyle(spec),
        }}
      >
        {(node.children ?? []).map(child => (
          <Node
            key={child.id}
            node={child}
            parent={spec}
            colors={colors}
            textStyles={textStyles}
            shows={shows}
            kindOf={kindOf}
            slot={slot}
          />
        ))}
      </div>
    )
  }

  // Decoration: no slot and no children, so it is a rule, band, or panel and
  // its style is the whole of it.
  if (!node.slot) {
    return (
      <div
        data-node-id={node.id}
        aria-hidden
        style={{ ...placement, ...surfaceStyle(style, colors) }}
      />
    )
  }

  // A slot with nothing to show takes no space at all, so a container's gap
  // does not reserve a hole where an absent caption would have gone.
  if (!shows(node.slot)) return null

  // A heading is marked up as one, so a deck can be skimmed by structure.
  const Element = ELEMENT_FOR[node.style?.textStyle ?? ''] ?? 'div'

  return (
    <Element
      data-node-id={node.id}
      // What this box holds, for the layout transition (lib/layoutFlip): a box
      // whose name changed between layouts is matched on this instead. The
      // style lives on the node rather than on the slot, so the tag goes here
      // and the animation reads it from the slot wrapper's nearest ancestor.
      data-flip-tier={tierOf(kindOf(node.slot), node.style?.textStyle)}
      className="overflow-hidden"
      style={{ ...placement, ...contentStyle(style, colors) }}
    >
      {node.before}
      {slot(node.slot)}
      {node.after}
    </Element>
  )
}

/**
 * The layout's outermost box, kept inside the template's safe area.
 *
 * Spreading a row or column pushes its contents to the ends of whatever
 * contains them, and for the outermost box that is the slide itself — so "at
 * the start" put text hard against the edge, outside the margins the template
 * asks for and the editor draws.
 *
 * Two conditions, and both are the point:
 *
 *   - only where the layout pads nothing itself, per axis. A layout that
 *     states its own margins has already made that decision.
 *   - only where the contents are actually pushed toward an edge. A centred
 *     column is nowhere near the margins, and padding it would shrink the
 *     room its boxes divide up — which would resize the picture on every
 *     two-column slide anyone has already made.
 */
const withSafeArea = (tree: LayoutNode, metrics: ThemeMetrics): LayoutNode => {
  const container = tree.container
  if (!container || container.mode !== 'flex') return tree
  if ((container.justify ?? 'start') === 'center') return tree

  const style = tree.style ?? {}
  const setsX = style.padding !== undefined || style.paddingX !== undefined
  const setsY = style.padding !== undefined || style.paddingY !== undefined
  if (setsX && setsY) return tree
  return {
    ...tree,
    style: {
      ...style,
      // Margins are fractions of the slide; padding is `cqi`, a percent of
      // its width. Same axis, so one is the other times a hundred.
      ...(setsX ? {} : { paddingX: metrics.marginX * 100 }),
      ...(setsY ? {} : { paddingY: metrics.marginY * 100 }),
    },
  }
}

export default function FlowLayout({
  layout,
  slide,
  colors,
  textStyles,
  metrics,
  editable,
  imagePending,
  slot,
}: LayoutProps) {
  const tree = layout?.tree
  const kindOf = (name: string): SlotKind =>
    layout?.slots.find(s => s.name === name)?.kind ?? 'text'
  const shows = (name: string) =>
    slotIsShown(slide, name, {
      kind: layout?.slots.find(s => s.name === name)?.kind,
      editable,
      imagePending,
    })
  // A layout with no tree is a blank slate — the whiteboard, or a layout
  // whose author has not built it yet. The frame already paints the theme.
  if (!tree) return <div className="h-full w-full" />
  return (
    <Node
      node={withSafeArea(tree, metrics)}
      colors={colors}
      textStyles={textStyles}
      shows={shows}
      kindOf={kindOf}
      slot={slot}
    />
  )
}
