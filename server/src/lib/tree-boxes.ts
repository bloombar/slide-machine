/**
 * Where a layout's boxes land, worked out from its tree without a browser.
 *
 * A layout is a tree of flex and grid containers (TMPL-4). On screen the
 * browser resolves that into rectangles, and the template editor measures what
 * it drew and stores the result in `elementPositions` for the exporters to
 * read. Anything the editor has never had open — every built-in, and any
 * layout whose tab an author never visited — therefore carries no geometry at
 * all, and an exporter that trusts `elementPositions` alone has nothing to
 * draw.
 *
 * So this resolves the same tree the renderer does, in the same units, with
 * the same rules: containers arrange their children, a `free` box sits at its
 * own coordinates, and a root that states no padding is given the template's
 * safe area. It is the renderer's arithmetic (client FlowLayout) rather than a
 * second design.
 *
 * ## The one approximation
 *
 * CSS sizes a text box by measuring the glyphs. Without a font engine that
 * cannot be exact, so a line count is estimated from the type size and the
 * width available. Everything else — placement, distribution, gaps, padding,
 * grow, grid tracks — is arithmetic and is exact.
 *
 * ## Units
 *
 * Internally everything is `cqi`: a percent of the slide's WIDTH, on both
 * axes, which is the unit the model states gaps, padding and type in. A 16:9
 * slide is therefore 100 wide and 56.25 tall. Boxes come out as fractions of
 * the slide, which is what `elementPositions` and the exporters speak.
 */
import {
  defaultLayoutTree,
  themeTextStyles,
  treeFromSlots,
  type BoxStyle,
  type ContainerSpec,
  type Layout,
  type LayoutNode,
  type SlotSpec,
  type ThemeTextStyles,
} from '@slide-machine/shared'

/** Slides are always 16:9, so the slide is this tall in `cqi`. */
const SLIDE_ASPECT = 16 / 9
const W = 100
const H = W / SLIDE_ASPECT

/** Line height when neither the box nor its text style names one — the
 * browser's own default for a normal line box. */
const DEFAULT_LINE_HEIGHT = 1.2

/** Average glyph width as a fraction of the type size. A sans-serif face at
 * mixed case runs close to half an em, which is what makes an estimated line
 * count land within a line of the real one for slide-length text. */
const AVG_CHAR_WIDTH = 0.5

/** Type size for a box that names no style, matching the renderer's own
 * fallback for an unstyled box. */
const DEFAULT_FONT_SIZE = 2.75

/** A rectangle in `cqi`. */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One box the layout reserves, as fractions of the slide. */
export interface ResolvedBox extends Rect {
  /** The node it came from, so a caller can read `before`/`after`. */
  node: LayoutNode
  /** The slot it shows; absent on decoration. */
  slot?: string
  /** What the box holds. Decoration holds nothing. */
  kind?: SlotSpec['kind']
  /** The style in force: the named text role with the box's own fields over
   * it, exactly as the renderer resolves it. */
  style: BoxStyle
}

/** What a box is going to be given to show, so its height can be estimated.
 * One entry per paragraph — a list contributes one per point. */
export type LinesOf = (slot: string, style: BoxStyle) => string[]

/**
 * A box's effective style: the text role it names, with any field it sets
 * itself over the top. The same cascade the renderer applies (client
 * boxStyle.ts) — a box naming a role and overriding one thing is the common
 * case, so it is one merge rather than a mode switch.
 *
 * Exported because it is the only correct way to read a box's type since
 * imports started deriving a type scale (`import/type-scale.ts`): a box that
 * follows a role no longer states the size, weight, family or colour the role
 * supplies, so reading the box alone reads a design with most of its
 * typography missing.
 */
export const resolveStyle = (
  style: BoxStyle | undefined,
  textStyles: ThemeTextStyles,
): BoxStyle => {
  if (!style) return {}
  const role = style.textStyle ? textStyles[style.textStyle] : undefined
  if (!role) return style
  const own = Object.fromEntries(
    Object.entries(style).filter(([, v]) => v !== undefined),
  )
  return { ...role, ...own }
}

/** A style's padding, per axis, in `cqi`. */
const padding = (style: BoxStyle): { x: number; y: number } => ({
  x: style.paddingX ?? style.padding ?? 0,
  y: style.paddingY ?? style.padding ?? 0,
})

/** The space inside a box once its padding is taken out. */
const inset = (rect: Rect, style: BoxStyle): Rect => {
  const p = padding(style)
  return {
    x: rect.x + p.x,
    y: rect.y + p.y,
    w: Math.max(0, rect.w - 2 * p.x),
    h: Math.max(0, rect.h - 2 * p.y),
  }
}

/**
 * A template's safe area, read the way the client reads it.
 *
 * Duplicated from `themeMetrics` rather than imported because that lives in
 * the client bundle; the numbers and the clamp are the same, and a template
 * that states neither gets the margins the editor has always seeded.
 */
const safeArea = (theme: Record<string, unknown>): { x: number; y: number } => {
  const metric = (key: string): number => {
    const raw = theme[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.06
    return Math.min(0.45, Math.max(0, raw))
  }
  return { x: metric('marginX'), y: metric('marginY') }
}

/**
 * The layout's outermost box, kept inside the safe area (client
 * `withSafeArea`). A root that states its own padding on an axis has already
 * made that decision and keeps it; the pull-quote is the one built-in that
 * does.
 */
const withSafeArea = (
  tree: LayoutNode,
  theme: Record<string, unknown>,
): LayoutNode => {
  if (!tree.container) return tree
  const style = tree.style ?? {}
  const setsX = style.padding !== undefined || style.paddingX !== undefined
  const setsY = style.padding !== undefined || style.paddingY !== undefined
  if (setsX && setsY) return tree
  const margin = safeArea(theme)
  return {
    ...tree,
    style: {
      ...style,
      // Margins are fractions of the slide; padding is `cqi`, a percent of its
      // width on both axes. So a side margin is the fraction times a hundred,
      // and a top margin, being a fraction of the height, is that over the
      // aspect ratio.
      ...(setsX ? {} : { paddingX: margin.x * 100 }),
      ...(setsY ? {} : { paddingY: (margin.y * 100) / SLIDE_ASPECT }),
    },
  }
}

/** How many lines a paragraph takes at this size in this width. */
const lineCount = (text: string, fontSize: number, availW: number): number => {
  if (!text) return 0
  const perLine = Math.max(1, Math.floor(availW / (fontSize * AVG_CHAR_WIDTH)))
  return Math.max(1, Math.ceil(text.length / perLine))
}

/** The gaps a container puts between its children, per axis. */
const gaps = (spec: ContainerSpec): { x: number; y: number } => ({
  x: spec.gapX ?? spec.gap ?? 0,
  y: spec.gapY ?? spec.gap ?? 0,
})

/** The state every step of the walk needs. */
interface Ctx {
  textStyles: ThemeTextStyles
  kindOf: (slot: string) => SlotSpec['kind'] | undefined
  lines: LinesOf
}

/**
 * Whether a node is drawn at all.
 *
 * A node naming a slot the layout does not declare takes no room and shows
 * nothing, which is what the renderer does with a slot that has nothing in it.
 * It happens whenever a layout borrows the default tree for its type and then
 * drops one of that type's boxes.
 */
const shows = (node: LayoutNode, ctx: Ctx): boolean =>
  !node.slot || ctx.kindOf(node.slot) !== undefined

/** The children a container actually arranges: a `free` box takes no room
 * from its siblings, so it is not among them. */
const flowChildren = (node: LayoutNode, ctx: Ctx): LayoutNode[] =>
  (node.children ?? []).filter(child => !child.free && shows(child, ctx))

/**
 * How tall a node wants to be, given the width it has, in `cqi`.
 *
 * This is CSS content sizing: what a box takes when nothing stretches it.
 * A percentage height inside it resolves against nothing here, so it counts as
 * content-sized — which is what CSS does with a percentage against an
 * auto-height parent.
 */
const contentHeight = (node: LayoutNode, availW: number, ctx: Ctx): number => {
  const style = resolveStyle(node.style, ctx.textStyles)
  const p = padding(style)
  const innerW = Math.max(0, availW - 2 * p.x)

  if (node.container) {
    const spec = node.container
    const kids = flowChildren(node, ctx)
    if (!kids.length) return 2 * p.y
    const g = gaps(spec)
    if (spec.mode === 'grid') {
      const rows = gridRows(kids, spec)
      const colW = trackWidth(innerW, spec, g.x)
      const heights = rows.map(row =>
        Math.max(0, ...row.map(k => contentHeight(k, colW, ctx))),
      )
      return sum(heights) + g.y * (rows.length - 1) + 2 * p.y
    }
    if (spec.direction === 'row') {
      const each = (innerW - g.x * (kids.length - 1)) / kids.length
      return (
        Math.max(0, ...kids.map(k => contentHeight(k, each, ctx))) + 2 * p.y
      )
    }
    const heights = kids.map(k => contentHeight(k, innerW, ctx))
    return sum(heights) + g.y * (kids.length - 1) + 2 * p.y
  }

  if (!node.slot) {
    // Decoration: a rule or a band. It is exactly as tall as it says, and a
    // node that says nothing occupies nothing.
    return 2 * p.y
  }

  if (ctx.kindOf(node.slot) === 'image') {
    // A picture has no intrinsic size here. Left to `grow` or an explicit
    // height, and given the room left over when it has neither.
    return 0
  }

  const size = style.fontSize ?? DEFAULT_FONT_SIZE
  const leading = style.lineHeight ?? DEFAULT_LINE_HEIGHT
  const paragraphs = ctx.lines(node.slot, style)
  const lines = sum(paragraphs.map(text => lineCount(text, size, innerW)))
  return Math.max(1, lines) * size * leading + 2 * p.y
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

/** A grid's children in rows, honouring `colSpan`. */
const gridRows = (kids: LayoutNode[], spec: ContainerSpec): LayoutNode[][] => {
  const columns = Math.max(1, spec.columns ?? 1)
  const rows: LayoutNode[][] = []
  let row: LayoutNode[] = []
  let filled = 0
  for (const kid of kids) {
    const span = Math.min(columns, Math.max(1, kid.colSpan ?? 1))
    if (filled + span > columns && row.length) {
      rows.push(row)
      row = []
      filled = 0
    }
    row.push(kid)
    filled += span
  }
  if (row.length) rows.push(row)
  return rows
}

/** One column of a grid. */
const trackWidth = (
  innerW: number,
  spec: ContainerSpec,
  gapX: number,
): number => {
  const columns = Math.max(1, spec.columns ?? 1)
  return (innerW - gapX * (columns - 1)) / columns
}

/** Where free space goes along the main axis, for each `justify` value. */
const distribute = (
  free: number,
  count: number,
  justify: ContainerSpec['justify'],
): { offset: number; between: number } => {
  const room = Math.max(0, free)
  switch (justify) {
    case 'center':
      return { offset: room / 2, between: 0 }
    case 'end':
      return { offset: room, between: 0 }
    case 'between':
      return { offset: 0, between: count > 1 ? room / (count - 1) : 0 }
    case 'around': {
      const share = count ? room / count : 0
      return { offset: share / 2, between: share }
    }
    case 'evenly': {
      const share = room / (count + 1)
      return { offset: share, between: share }
    }
    default:
      return { offset: 0, between: 0 }
  }
}

/** Where a child sits across the axis it does not fill. */
const alignWithin = (
  start: number,
  available: number,
  size: number,
  align: ContainerSpec['alignItems'],
): number => {
  const slack = Math.max(0, available - size)
  if (align === 'center') return start + slack / 2
  if (align === 'end') return start + slack
  return start
}

/**
 * Walks the tree, placing every node, and collects the boxes that draw
 * something: the slots, and the decoration a design is partly made of.
 */
const place = (
  node: LayoutNode,
  rect: Rect,
  ctx: Ctx,
  out: ResolvedBox[],
): void => {
  const style = resolveStyle(node.style, ctx.textStyles)

  if (node.container) {
    const inner = inset(rect, style)
    // A box that fills or tints itself is part of the design even when it is
    // a container, so it is collected before its children are placed over it.
    if (style.background || style.borderWidth) {
      out.push({ node, style, ...toFractions(rect) })
    }
    arrange(node, inner, ctx, out)
  } else if (node.slot) {
    out.push({
      node,
      slot: node.slot,
      kind: ctx.kindOf(node.slot),
      style,
      ...toFractions(rect),
    })
  } else {
    out.push({ node, style, ...toFractions(rect) })
  }

  // A `free` child is placed against the box that contains it, whatever that
  // box is arranging for everyone else.
  for (const child of node.children ?? []) {
    if (!child.free || !shows(child, ctx)) continue
    const box = child.box ?? { x: 0.2, y: 0.2, w: 0.6, h: 0.3 }
    const inner = inset(rect, style)
    place(
      child,
      {
        x: inner.x + box.x * inner.w,
        y: inner.y + box.y * inner.h,
        w: box.w * inner.w,
        h: box.h * inner.h,
      },
      ctx,
      out,
    )
  }
}

/** A container's children, laid out inside the space it has for them. */
const arrange = (
  node: LayoutNode,
  inner: Rect,
  ctx: Ctx,
  out: ResolvedBox[],
): void => {
  const spec = node.container!
  const kids = flowChildren(node, ctx)
  if (!kids.length) return
  const g = gaps(spec)

  if (spec.mode === 'grid') {
    const rows = gridRows(kids, spec)
    const colW = trackWidth(inner.w, spec, g.x)
    const columns = Math.max(1, spec.columns ?? 1)
    // Auto rows take what their contents need; whatever is left over is shared
    // between them, which is what makes a single-row grid fill the slide the
    // way `1fr` does on screen.
    const needed = rows.map(row =>
      Math.max(0, ...row.map(k => contentHeight(k, colW, ctx))),
    )
    const spare = inner.h - sum(needed) - g.y * (rows.length - 1)
    const share = rows.length ? Math.max(0, spare) / rows.length : 0
    const rowH = spec.rows
      ? rows.map(() => (inner.h - g.y * (rows.length - 1)) / rows.length)
      : needed.map(n => n + share)

    let y = inner.y
    rows.forEach((row, r) => {
      let x = inner.x
      const height = rowH[r] ?? 0
      for (const kid of row) {
        const span = Math.min(columns, Math.max(1, kid.colSpan ?? 1))
        const cellW = colW * span + g.x * (span - 1)
        const cell = { x, y, w: cellW, h: height }
        place(kid, cellBox(kid, cell, spec, ctx), ctx, out)
        x += cellW + g.x
      }
      y += height + g.y
    })
    return
  }

  const row = spec.direction === 'row'
  const mainAvail = row ? inner.w : inner.h
  const crossAvail = row ? inner.h : inner.w
  const gapMain = row ? g.x : g.y

  // A row whose children say nothing about their size shares itself out
  // equally: without glyph measurement there is no honest content width, and
  // equal columns are what such a row is nearly always for.
  const bare =
    row &&
    kids.every(
      k =>
        k.grow === undefined &&
        k.basis === undefined &&
        k.width === undefined &&
        !k.container,
    )

  const base = kids.map(kid => {
    if (bare) return 0
    const explicit = row ? (kid.basis ?? kid.width) : (kid.basis ?? kid.height)
    if (explicit !== undefined) return explicit * mainAvail
    if (kid.grow) return 0
    return row ? mainAvail / kids.length : contentHeight(kid, crossAvail, ctx)
  })

  const growth = kids.map(kid =>
    bare ? 1 : (kid.grow ?? (isGreedy(kid, ctx) ? 1 : 0)),
  )
  const totalGrow = sum(growth)
  const free = mainAvail - sum(base) - gapMain * (kids.length - 1)
  /*
   * What each child yields when the line is over-full, as CSS does it.
   *
   * `flex-shrink` defaults to 1 and is scaled by the child's own base size,
   * so a big box gives up more than a small one. Floored at zero, because the
   * renderer sets `min-height: 0` on every flow child (client FlowLayout) and
   * a box can therefore be taken to nothing.
   *
   * Without this the resolver distributed surplus and ignored deficit, so an
   * over-full column kept every child at its content height and simply ran
   * off the slide — while the browser shrank the same boxes and kept them on
   * it. That gap is only visible from the export, which is the one reader of
   * this file that draws without a browser to correct it (TMPL-22).
   *
   * Deficit and surplus cannot both apply, so this is the same branch rather
   * than a second pass: `free` is one number and it has one sign.
   */
  const shrinkWeight = kids.map((kid, i) => (kid.shrink ?? 1) * (base[i] ?? 0))
  const totalShrink = sum(shrinkWeight)
  const sizes = base.map((size, i) => {
    if (totalGrow > 0 && free > 0)
      return size + (free * (growth[i] ?? 0)) / totalGrow
    // Nothing that can give way means the line stays over-full and overflows,
    // which is what CSS does with a row of `flex-shrink: 0` children.
    if (free < 0 && totalShrink > 0)
      return Math.max(0, size + (free * (shrinkWeight[i] ?? 0)) / totalShrink)
    return size
  })

  const { offset, between } =
    totalGrow > 0 && free > 0
      ? { offset: 0, between: 0 }
      : distribute(free, kids.length, spec.justify)

  let main = (row ? inner.x : inner.y) + offset
  kids.forEach((kid, i) => {
    const size = sizes[i] ?? 0
    // Across the axis it does not fill, a box takes the width it asks for, or
    // all of it, and sits where the container aligns it.
    const askedCross = row ? kid.height : kid.width
    const crossSize =
      askedCross !== undefined
        ? askedCross * crossAvail
        : spec.alignItems && spec.alignItems !== 'stretch'
          ? crossOf(kid, crossAvail, row, ctx)
          : crossAvail
    const cross = alignWithin(
      row ? inner.y : inner.x,
      crossAvail,
      crossSize,
      spec.alignItems,
    )
    const rect = row
      ? { x: main, y: cross, w: size, h: crossSize }
      : { x: cross, y: main, w: crossSize, h: size }
    place(kid, rect, ctx, out)
    main += size + gapMain + between
  })
}

/**
 * A box that should take the room left over even though it never said so: a
 * picture with no size of its own. Text is content-sized, so it stays as tall
 * as its lines.
 */
const isGreedy = (node: LayoutNode, ctx: Ctx): boolean =>
  !!node.slot &&
  ctx.kindOf(node.slot) === 'image' &&
  node.height === undefined &&
  node.basis === undefined

/** How big a box is across the axis its container does not lay it out on,
 * when the container aligns rather than stretches. */
const crossOf = (
  node: LayoutNode,
  crossAvail: number,
  row: boolean,
  ctx: Ctx,
): number => {
  // In a row, that is height: content sizing answers it.
  if (row) return Math.min(crossAvail, contentHeight(node, crossAvail, ctx))
  // In a column it is width. Text is centred inside its own box by its style,
  // so a full-width box lands the words in the same place a shrink-to-fit one
  // would, and keeps the room a longer line would need.
  return crossAvail
}

/** How a child sits inside its grid cell. */
const cellBox = (
  node: LayoutNode,
  cell: Rect,
  spec: ContainerSpec,
  ctx: Ctx,
): Rect => {
  const h =
    node.height !== undefined
      ? node.height * cell.h
      : spec.alignItems && spec.alignItems !== 'stretch'
        ? Math.min(cell.h, contentHeight(node, cell.w, ctx))
        : cell.h
  const w = node.width !== undefined ? node.width * cell.w : cell.w
  return {
    x: alignWithin(
      cell.x,
      cell.w,
      w,
      spec.justify as ContainerSpec['alignItems'],
    ),
    y: alignWithin(cell.y, cell.h, h, spec.alignItems),
    w,
    h,
  }
}

/** `cqi` to fractions of the slide. */
const toFractions = (rect: Rect): Rect => ({
  x: rect.x / W,
  y: rect.y / H,
  w: rect.w / W,
  h: rect.h / H,
})

/**
 * Every box a layout draws, as fractions of the slide, in paint order.
 *
 * The tree is the design, so it is read first — the same order the renderer
 * picks in (tree, then `elementPositions`, then nothing). A layout with no
 * tree of its own falls back to the default for its conventional type, and
 * then to a plain stack of whatever slots it declares, which is what an
 * author's own layout gets before they have arranged it.
 */
export const resolveTreeBoxes = (
  layout: Pick<Layout, 'type' | 'slots' | 'tree'>,
  theme: Record<string, unknown>,
  lines: LinesOf,
): ResolvedBox[] => {
  const tree =
    layout.tree ?? defaultLayoutTree(layout.type) ?? treeFromSlots(layout.slots)
  if (!tree) return []
  const ctx: Ctx = {
    textStyles: themeTextStyles(theme),
    kindOf: name => layout.slots.find(s => s.name === name)?.kind,
    lines,
  }
  const out: ResolvedBox[] = []
  const root = withSafeArea(tree, theme)
  place(root, { x: 0, y: 0, w: W, h: H }, ctx, out)
  // The root itself is the slide; it is never a box the export draws.
  return out.filter(box => box.node !== root && box.w > 0 && box.h > 0)
}

/**
 * What a layout's ROOT column needs from itself, against what it has.
 *
 * `resolveTreeBoxes` answers where a box lands once the arrangement has been
 * worked out — which means a box that grows reports the room it was given and
 * a box that shrinks reports the room it was left. Neither is what a budget
 * describes. A budget says how much text a box holds, and the question this
 * answers is the one nobody could ask before: filled to their own stated
 * budgets ALL AT ONCE, do a column's boxes need more room than the column has
 * (TMPL-19)?
 *
 * So every child is measured at its CONTENT height, with `grow` and `shrink`
 * ignored on purpose. Those two decide who wins a fight over room; this is
 * about whether there is a fight.
 *
 * ## Only the root, and only a flex column
 *
 * A nested column's height is whatever its parent gave it, so its demand
 * cannot be stated without resolving the parent, and a figure derived that way
 * would be reporting the arrangement rather than the budgets. A caller is told
 * `null` and why, rather than handed a number that looks like the others.
 *
 * ## What a satisfied demand does NOT mean
 *
 * That the layout draws correctly. A column with room to spare can still put
 * type on the floor, clip a descender or hide a line, because none of that is
 * arithmetic over rectangles — it is glyph metrics and the type fitter, and
 * this has neither (TMPL-20). Room enough is necessary and it is not
 * sufficient.
 */
export interface ColumnDemand {
  /** Room the column has for its children, `cqi`. */
  available: number
  /** Room its children want, plus the gaps between them, `cqi`. */
  needed: number
  /** Per child, so a caller can say which box is the expensive one. */
  children: { id: string; slot?: string; needs: number }[]
  /** What the gaps cost in total, `cqi`. */
  gaps: number
}

/**
 * The root column's demand, or `null` with the reason it has none — a layout
 * arranged as a grid, as absolutely placed boxes, or with no tree at all.
 */
export const columnDemand = (
  layout: Pick<Layout, 'type' | 'slots' | 'tree'>,
  theme: Record<string, unknown>,
  lines: LinesOf,
): { demand: ColumnDemand } | { demand: null; why: string } => {
  const tree =
    layout.tree ?? defaultLayoutTree(layout.type) ?? treeFromSlots(layout.slots)
  if (!tree) return { demand: null, why: 'the layout has no tree' }
  const spec = tree.container
  if (!spec) return { demand: null, why: 'the root is a single box' }
  if (spec.mode !== 'flex' || spec.direction !== 'column')
    return {
      demand: null,
      why: `the root is a ${spec.mode === 'grid' ? 'grid' : `flex ${spec.direction ?? 'row'}`}`,
    }
  const ctx: Ctx = {
    textStyles: themeTextStyles(theme),
    kindOf: name => layout.slots.find(s => s.name === name)?.kind,
    lines,
  }
  const root = withSafeArea(tree, theme)
  const kids = flowChildren(root, ctx)
  if (!kids.length)
    return { demand: null, why: 'every child is placed absolutely' }
  const p = padding(resolveStyle(root.style, ctx.textStyles))
  const innerW = Math.max(0, W - 2 * p.x)
  const children = kids.map(kid => ({
    id: kid.id,
    ...(kid.slot ? { slot: kid.slot } : {}),
    needs: contentHeight(kid, innerW, ctx),
  }))
  const gapTotal = gaps(spec).y * (kids.length - 1)
  return {
    demand: {
      available: Math.max(0, H - 2 * p.y),
      needed: sum(children.map(c => c.needs)) + gapTotal,
      children,
      gaps: gapTotal,
    },
  }
}
