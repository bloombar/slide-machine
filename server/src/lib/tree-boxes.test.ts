/**
 * Unit tests for resolving a layout's tree into absolute boxes without a
 * browser (EXP-6).
 *
 * The exporters cannot run CSS, and every built-in layout carries an empty
 * `elementPositions`, so this is the only thing standing between a template
 * and an export of blank slides. What the tests check is that it reproduces
 * the renderer's rules: the safe area, vertical centring, gaps, grid tracks,
 * `grow`, and boxes lifted out of the flow.
 *
 * Positions are fractions of the slide, so they can be asserted directly
 * against what the design says.
 */
import { describe, it, expect } from 'vitest'
import type { Layout, LayoutNode } from '@slide-machine/shared'
import { resolveTreeBoxes, type ResolvedBox } from './tree-boxes'

/** A 16:9 slide is this many times wider than it is tall. */
const ASPECT = 16 / 9

const theme = { background: '#ffffff', text: '#111111', accent: '#0055ff' }

const layout = (
  over: Partial<Layout> & { tree?: LayoutNode } = {},
): Pick<Layout, 'type' | 'slots' | 'tree'> => ({
  type: 'content',
  slots: [
    { name: 'title', kind: 'text', label: 'Title' },
    { name: 'body', kind: 'text', label: 'Body' },
  ],
  ...over,
})

/** One short line per box, so heights are predictable. */
const oneLine = () => ['Nine char']

const at = (boxes: ResolvedBox[], slot: string): ResolvedBox => {
  const found = boxes.find(b => b.slot === slot)
  expect(found, `no box for ${slot}`).toBeDefined()
  return found!
}

describe('a layout with no tree of its own', () => {
  it('falls back to the default tree for its conventional type', () => {
    // Every built-in is in exactly this position: a type, and no geometry
    const boxes = resolveTreeBoxes(layout({ tree: undefined }), theme, oneLine)
    expect(boxes.map(b => b.slot)).toEqual(['title', 'body'])
  })

  it('stacks the slots of a layout its author named themselves (TMPL-9)', () => {
    const boxes = resolveTreeBoxes(
      { type: 'lab-safety', slots: layout().slots, tree: undefined },
      theme,
      oneLine,
    )
    expect(boxes.map(b => b.slot)).toEqual(['title', 'body'])
  })

  it('draws nothing for a layout with neither tree nor slots', () => {
    // The whiteboard: a blank slate, and an invented box would be a lie
    expect(
      resolveTreeBoxes({ type: 'whiteboard', slots: [] }, theme, oneLine),
    ).toEqual([])
  })

  it('leaves out a box for a slot the layout does not declare', () => {
    // A layout that borrowed `content`'s tree and dropped the body
    const boxes = resolveTreeBoxes(
      {
        type: 'content',
        slots: [{ name: 'title', kind: 'text', label: 'Title' }],
      },
      theme,
      oneLine,
    )
    expect(boxes.map(b => b.slot)).toEqual(['title'])
  })
})

describe('the safe area', () => {
  it('insets every box by the template’s own margins', () => {
    const boxes = resolveTreeBoxes(layout(), theme, oneLine)
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(0.06, 3)
      expect(box.w).toBeCloseTo(0.88, 3)
    }
  })

  it('follows a margin the template sets instead of the default', () => {
    const boxes = resolveTreeBoxes(
      layout(),
      { ...theme, marginX: 0.2 },
      oneLine,
    )
    expect(at(boxes, 'title').x).toBeCloseTo(0.2, 3)
    expect(at(boxes, 'title').w).toBeCloseTo(0.6, 3)
  })

  it('leaves a root that states its own padding alone', () => {
    // The pull-quote asks for wider sides, and keeps them
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          style: { paddingX: 8, paddingY: 8 },
          container: { mode: 'flex', direction: 'column' },
          children: [{ id: 'a', slot: 'title' }],
        },
      }),
      theme,
      oneLine,
    )
    expect(at(boxes, 'title').x).toBeCloseTo(0.08, 3)
  })
})

describe('a column', () => {
  it('centres its contents when it says to', () => {
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column', justify: 'center' },
          children: [{ id: 'a', slot: 'title' }],
        },
      }),
      theme,
      oneLine,
    )
    const box = at(boxes, 'title')
    // Equal space above and below is what "centred" has to mean
    expect(box.y + box.h / 2).toBeCloseTo(0.5, 2)
  })

  it('stacks from the top otherwise, below the margin', () => {
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [{ id: 'a', slot: 'title' }],
        },
      }),
      theme,
      oneLine,
    )
    expect(at(boxes, 'title').y).toBeCloseTo(0.06, 2)
  })

  it('puts the gap it asks for between its boxes', () => {
    const gap = 6 // cqi: 6% of the WIDTH, on the vertical axis too
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column', gap },
          children: [
            { id: 'a', slot: 'title' },
            { id: 'b', slot: 'body' },
          ],
        },
      }),
      theme,
      oneLine,
    )
    const title = at(boxes, 'title')
    const body = at(boxes, 'body')
    expect(body.y - (title.y + title.h)).toBeCloseTo((gap / 100) * ASPECT, 3)
  })

  it('gives the room left over to a box that grows', () => {
    const boxes = resolveTreeBoxes(
      {
        type: 'image-heavy',
        slots: [
          { name: 'image', kind: 'image', label: 'Image' },
          { name: 'caption', kind: 'text', label: 'Caption' },
        ],
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [
            { id: 'i', slot: 'image', grow: 1 },
            { id: 'c', slot: 'caption' },
          ],
        },
      },
      theme,
      oneLine,
    )
    const image = at(boxes, 'image')
    const caption = at(boxes, 'caption')
    // The picture fills down to the caption, and the pair fill the safe area
    expect(image.y).toBeCloseTo(0.06, 2)
    expect(image.y + image.h).toBeCloseTo(caption.y, 3)
    expect(caption.y + caption.h).toBeCloseTo(0.94, 2)
  })

  it('gives a picture that asked for nothing the room anyway', () => {
    // Text is as tall as its lines; a picture with no size would be a
    // zero-height box, which is a picture nobody can see
    const boxes = resolveTreeBoxes(
      {
        type: 'photo',
        slots: [{ name: 'image', kind: 'image', label: 'Image' }],
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [{ id: 'i', slot: 'image' }],
        },
      },
      theme,
      oneLine,
    )
    expect(at(boxes, 'image').h).toBeCloseTo(0.88, 2)
  })
})

describe('a grid', () => {
  it('splits itself into equal columns, gap included', () => {
    const boxes = resolveTreeBoxes(
      {
        type: 'two-column',
        slots: [
          { name: 'body', kind: 'text', label: 'Body' },
          { name: 'image', kind: 'image', label: 'Image' },
        ],
        tree: {
          id: 'root',
          container: { mode: 'grid', columns: 2, gap: 4 },
          children: [
            { id: 'a', slot: 'body' },
            { id: 'b', slot: 'image' },
          ],
        },
      },
      theme,
      oneLine,
    )
    const left = at(boxes, 'body')
    const right = at(boxes, 'image')
    expect(left.w).toBeCloseTo(0.42, 3)
    expect(right.w).toBeCloseTo(0.42, 3)
    expect(right.x - (left.x + left.w)).toBeCloseTo(0.04, 3)
  })

  it('centres a box across its row when it is told to align rather than stretch', () => {
    const boxes = resolveTreeBoxes(
      {
        type: 'two-column',
        slots: [{ name: 'image', kind: 'image', label: 'Image' }],
        tree: {
          id: 'root',
          container: { mode: 'grid', columns: 2, alignItems: 'center' },
          children: [{ id: 'b', slot: 'image', height: 0.5 }],
        },
      },
      theme,
      oneLine,
    )
    const image = at(boxes, 'image')
    expect(image.y + image.h / 2).toBeCloseTo(0.5, 2)
    expect(image.h).toBeCloseTo(0.88 / 2, 2)
  })
})

describe('decoration and free boxes', () => {
  it('keeps a rule that shows no content but is part of the design', () => {
    // The section break's accent bar: no slot, no children, style is all of it
    const boxes = resolveTreeBoxes(
      {
        type: 'section',
        slots: [{ name: 'title', kind: 'text', label: 'Title' }],
      },
      theme,
      oneLine,
    )
    const rule = boxes.find(b => !b.slot)
    expect(rule).toBeDefined()
    expect(rule!.style.background).toBe('accent')
    expect(rule!.w).toBeCloseTo(0.88 * 0.08, 3)
  })

  it('places a box that lifted itself out of the flow at its own coordinates', () => {
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          style: { padding: 0 },
          container: { mode: 'flex', direction: 'column' },
          children: [
            { id: 'a', slot: 'title' },
            {
              id: 'b',
              slot: 'body',
              free: true,
              box: { x: 0.5, y: 0.25, w: 0.4, h: 0.2 },
            },
          ],
        },
      }),
      theme,
      oneLine,
    )
    expect(at(boxes, 'body')).toMatchObject({ x: 0.5, y: 0.25, w: 0.4 })
  })
})

describe('the style a box is drawn in', () => {
  it('resolves the named text role the box follows', () => {
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [{ id: 'a', slot: 'title', style: { textStyle: 'title' } }],
        },
      }),
      theme,
      oneLine,
    )
    // Geometry alone is not the design: a title exported at body size would
    // be the right rectangle holding the wrong slide
    expect(at(boxes, 'title').style).toMatchObject({
      fontSize: 7,
      fontWeight: 700,
    })
  })

  it('lets the box override one field of the role it follows', () => {
    const boxes = resolveTreeBoxes(
      layout({
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [
            {
              id: 'a',
              slot: 'title',
              style: { textStyle: 'title', fontSize: 3, align: 'center' },
            },
          ],
        },
      }),
      theme,
      oneLine,
    )
    expect(at(boxes, 'title').style).toMatchObject({
      fontSize: 3,
      fontWeight: 700,
      align: 'center',
    })
  })

  it('makes a box tall enough for the text it will hold', () => {
    const short = resolveTreeBoxes(layout(), theme, () => ['One line'])
    const long = resolveTreeBoxes(layout(), theme, () => ['x'.repeat(400)])
    expect(at(long, 'title').h).toBeGreaterThan(at(short, 'title').h)
  })
})
