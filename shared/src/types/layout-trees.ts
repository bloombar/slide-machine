/**
 * The conventional layouts, as data (TMPL-2/TMPL-4).
 *
 * Each of these was a hand-written React component until the layout model
 * became a tree. They are reproduced here field for field — the same gaps,
 * paddings and alignments, in the same `cqi` units the components used — so
 * that converting a template to the tree model does not move anything on a
 * slide someone already made.
 *
 * Typography is named rather than written out: a box says `textStyle:
 * 'heading'` and the template's own text styles decide what that means. That
 * is the point of the migration — the built-ins stop being seven private type
 * scales and become one an author can edit.
 *
 * Two jobs beyond shipping the built-ins:
 *   - a template saved before the tree model adopts the matching tree on read,
 *     so it keeps rendering as it always did (`adoptDefaultTree`, server)
 *   - adding a conventional layout in the editor starts from one of these
 */
import type { BoxStyle, LayoutNode } from './template'

/**
 * A margin a layout asks for instead of the template's.
 *
 * Layouts used to state their own side margins, copied from the components
 * they replaced (`px-[6cqi]`). They no longer do: a root that says nothing is
 * given the template's own safe area, which is what makes every slide in a
 * template share one margin and lets an author change it in one place
 * (`withSafeArea`, client). What is left here is the one deliberate
 * exception — a pull-quote is set large and centred, and a wider inset keeps
 * the line length readable.
 */
const PAD_WIDE = 8

/**
 * The section rule was `0.4cqi` tall — a fraction of the slide's WIDTH.
 * A node's `height` is a fraction of its container's height, so converting
 * costs one multiply by the aspect ratio. Slides are always 16:9
 * (`aspect-video` on the frame), so this is exact rather than approximate.
 */
const RULE_HEIGHT = (0.4 / 100) * (16 / 9)

/** Title and body, centred vertically. */
const content: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    gap: 3,
  },
  children: [
    { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
    { id: 'body', slot: 'body', style: { textStyle: 'body' } },
  ],
}

/** Title and a bullet list — content, with bullets in place of the paragraph. */
const list: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    gap: 3,
  },
  children: [
    { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
    { id: 'bullets', slot: 'bullets', style: { textStyle: 'bullet' } },
  ],
}

/** The opening slide: one large title, centred, with room for a subtitle. */
const title: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    alignItems: 'center',
    gap: 2,
  },
  children: [
    {
      id: 'title',
      slot: 'title',
      style: { textStyle: 'title', align: 'center' },
    },
    {
      id: 'caption',
      slot: 'caption',
      style: { textStyle: 'caption', align: 'center' },
    },
  ],
}

/**
 * A section break: an accent rule above a heading.
 *
 * The rule is a node with no slot and no children — decoration, drawn from its
 * style alone. It is why the model has such nodes at all: the component drew
 * a bar that was never content, and dropping it would have changed the design.
 */
const section: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    alignItems: 'center',
    gap: 1.5,
  },
  children: [
    {
      id: 'rule',
      width: 0.08,
      height: RULE_HEIGHT,
      style: { background: 'accent', radius: 0.25 },
    },
    {
      id: 'title',
      slot: 'title',
      style: { textStyle: 'sectionTitle', align: 'center' },
    },
  ],
}

/** Text beside a supporting image, in two equal columns. */
const twoColumn: LayoutNode = {
  id: 'root',
  container: { mode: 'grid', columns: 2, gap: 4, alignItems: 'center' },
  children: [
    {
      id: 'text',
      container: { mode: 'flex', direction: 'column', gap: 2 },
      children: [
        { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
        { id: 'body', slot: 'body', style: { textStyle: 'body' } },
      ],
    },
    { id: 'image', slot: 'image', height: 0.75, style: { radius: 1 } },
  ],
}

/** A picture dominates; the caption is a footnote under it. */
const imageHeavy: LayoutNode = {
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 1.5 },
  children: [
    { id: 'image', slot: 'image', grow: 1, style: { radius: 1 } },
    {
      id: 'caption',
      slot: 'caption',
      style: { textStyle: 'caption', align: 'center' },
    },
  ],
}

/**
 * A single striking statement.
 *
 * The quotation marks are `before`/`after` on the body node — literal
 * characters the layout prints around the slot's content, not content itself.
 * The component wrote them inline, and without somewhere to put them the
 * conversion would have quietly dropped them.
 */
const quote: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    alignItems: 'center',
    gap: 2,
  },
  style: { paddingX: PAD_WIDE },
  children: [
    {
      id: 'body',
      slot: 'body',
      before: '“',
      after: '”',
      style: { textStyle: 'quote', align: 'center' },
    },
    {
      id: 'caption',
      slot: 'caption',
      style: { textStyle: 'caption', align: 'center' },
    },
  ],
}

/**
 * A program listing under its title.
 *
 * The listing takes the room left over and sits on the theme's surface, the
 * way a code block does everywhere else — a lecturer reading a loop aloud
 * should get the loop, set as code, not a paragraph about it (GEN-11).
 */
const code: LayoutNode = {
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 2 },
  children: [
    { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
    // No padding, background or corner of its own: the listing brings all
    // three. Setting them here too inset the text a second time, and the
    // fitter that picks a type size to keep the longest line on the slide
    // does not know about that second inset — so the line ran off the edge.
    { id: 'snippet', slot: 'snippet', grow: 1 },
  ],
}

/** One expression, set large and centred, with a short note under it. */
const formula: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    alignItems: 'center',
    gap: 2.5,
  },
  children: [
    {
      id: 'title',
      slot: 'title',
      style: { textStyle: 'heading', align: 'center' },
    },
    { id: 'eq', slot: 'eq', style: { align: 'center' } },
    {
      id: 'caption',
      slot: 'caption',
      style: { textStyle: 'caption', align: 'center' },
    },
  ],
}

/** The blank slate. No slots, nothing to arrange — the frame already paints
 * the theme, and the drawing tools own the surface (WB-1). */
const whiteboard: LayoutNode = { id: 'root' }

/**
 * A paragraph that sets something up, and the points that follow from it.
 *
 * `content` gives prose and `list` gives points, and a slide that wants both
 * had to pick one — so an instructor with a sentence of context above three
 * points either lost the context or wrote it as a fourth point. This is the
 * shape most lecture slides actually are.
 *
 * The prose sits above the points because that is the order it is read in,
 * and takes only the room it needs: the points are what the slide is for, and
 * a long intro should not squeeze them.
 */
const contentList: LayoutNode = {
  id: 'root',
  container: {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    gap: 2.5,
  },
  children: [
    { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
    { id: 'body', slot: 'body', style: { textStyle: 'body' } },
    { id: 'bullets', slot: 'bullets', grow: 1, style: { textStyle: 'bullet' } },
  ],
}

/** By conventional layout type. A type absent here has no default, which is
 * what a layout an author named themselves is. */
export const DEFAULT_LAYOUT_TREES: Record<string, LayoutNode> = {
  title,
  section,
  content,
  list,
  'content-list': contentList,
  'image-heavy': imageHeavy,
  'two-column': twoColumn,
  quote,
  code,
  formula,
  whiteboard,
}

/** A fresh copy, since callers store what they get and a shared object would
 * let one template's edits reach another's. */
export const defaultLayoutTree = (type: string): LayoutNode | undefined => {
  const tree = DEFAULT_LAYOUT_TREES[type]
  return tree ? structuredClone(tree) : undefined
}

/**
 * A tree for a layout that carries measured geometry instead — which is what
 * a design imported from Google Slides is (TMPL-8).
 *
 * An import arrives as absolute boxes and no tree, because that is what it
 * was: a deck laid out by hand, with no reusable structure to read. Those
 * layouts drew correctly and could be restyled, but could not be *built* on
 * — the editor's outline, and with it adding, removing and reordering boxes,
 * exists only for a tree. An instructor could import their own deck and then
 * not add a box to it.
 *
 * A tree of `free` boxes is the faithful conversion. Each slot keeps the
 * exact rectangle it was measured at and the styling it was given; nothing is
 * re-flowed and nothing moves. What changes is that the layout now has a
 * structure to edit, and a box added to it joins boxes rather than nothing.
 *
 * The root arranges nothing — every child opts out of the flow — and it
 * states a padding of zero on purpose. A `free` box is placed against its
 * parent's INNER rectangle, and a root that says nothing about padding is
 * seeded with the template's safe area: every imported box would then be
 * nudged inward and shrunk, which is a redesign rather than a conversion.
 */
export const treeFromPositions = (
  positions: Record<
    string,
    { x: number; y: number; w: number; h: number } & Record<string, unknown>
  >,
  slots: { name: string }[],
): LayoutNode | undefined => {
  // In the order the layout declares them, so paint order matches what the
  // positioned renderer drew.
  const placed = slots.filter(slot => positions[slot.name])
  if (!placed.length) return undefined
  return {
    id: 'root',
    container: { mode: 'flex', direction: 'column' },
    // Stated, not omitted: see above.
    style: { paddingX: 0, paddingY: 0 },
    children: placed.map(slot => {
      const { x, y, w, h, ...style } = positions[slot.name]!
      return {
        id: slot.name,
        slot: slot.name,
        free: true as const,
        box: { x, y, w, h },
        // The styling lived on the position; on a tree it lives on the node,
        // and dropping it here would import a design and then un-design it.
        ...(Object.keys(style).length ? { style: style as BoxStyle } : {}),
      }
    }),
  }
}

/**
 * A tree for a layout that has none and is not one of the conventional types —
 * a layout an author named themselves (TMPL-9).
 *
 * Stacks whatever slots it declares, sized by what they hold. Not a guess at
 * the design that was lost, but the same principle the generic renderer works
 * on: degraded, never blank. Without it a custom layout with no tree has no
 * boxes to show and nothing to edit, which is a dead end rather than a
 * starting point.
 */
export const treeFromSlots = (
  slots: { name: string; kind?: string }[],
): LayoutNode | undefined => {
  if (!slots.length) return undefined
  return {
    id: 'root',
    container: {
      mode: 'flex',
      direction: 'column',
      justify: 'center',
      gap: 3,
    },
    children: slots.map((slot, i) => ({
      id: slot.name,
      slot: slot.name,
      // A picture takes the room left over; the first text box reads as the
      // heading it almost always is.
      ...(slot.kind === 'image'
        ? { grow: 1, style: { radius: 1 } }
        : {
            style: {
              textStyle:
                slot.kind === 'bullets'
                  ? 'bullet'
                  : i === 0
                    ? 'heading'
                    : 'body',
            },
          }),
    })),
  }
}
