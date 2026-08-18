/**
 * Unit tests for turning measured geometry into a tree (TMPL-8/TMPL-9).
 *
 * A design imported from Google Slides arrives as absolute boxes and no
 * tree, because that is what it was. Those layouts drew correctly and could
 * be restyled, but could not be built on: the editor's outline — and with it
 * adding, removing and reordering boxes — exists only for a tree, so an
 * instructor could import their own deck and then not add a box to it.
 *
 * The conversion has one hard requirement: nothing may move. What is checked
 * here is that it doesn't.
 */
import { describe, it, expect } from 'vitest'
import { treeFromPositions } from './layout-trees'

const positions = {
  title: {
    x: 0.08,
    y: 0.07,
    w: 0.84,
    h: 0.14,
    fontSize: 4.2,
    color: '#123456',
  },
  body: { x: 0.08, y: 0.28, w: 0.44, h: 0.5, fontSize: 2.1 },
  picture: { x: 0.56, y: 0.28, w: 0.36, h: 0.5 },
}

const slots = [{ name: 'title' }, { name: 'body' }, { name: 'picture' }]

describe('a tree built from measured boxes', () => {
  it('places every slot at exactly the rectangle it was measured at', () => {
    const tree = treeFromPositions(positions, slots)
    const boxes = Object.fromEntries(
      (tree?.children ?? []).map(child => [child.slot, child.box]),
    )
    expect(boxes).toEqual({
      title: { x: 0.08, y: 0.07, w: 0.84, h: 0.14 },
      body: { x: 0.08, y: 0.28, w: 0.44, h: 0.5 },
      picture: { x: 0.56, y: 0.28, w: 0.36, h: 0.5 },
    })
  })

  it('lifts every box out of the flow, so nothing is re-arranged', () => {
    const tree = treeFromPositions(positions, slots)
    expect((tree?.children ?? []).every(child => child.free)).toBe(true)
  })

  it('states a padding of zero, so the safe area cannot shift the boxes', () => {
    // A root that says nothing about padding is seeded with the template's
    // safe area, and every imported box would be nudged inward and shrunk.
    const tree = treeFromPositions(positions, slots)
    expect(tree?.style).toMatchObject({ paddingX: 0, paddingY: 0 })
  })

  it('keeps the styling the box was given', () => {
    // The styling lived on the position; on a tree it lives on the node.
    // Dropping it would import a design and then un-design it.
    const tree = treeFromPositions(positions, slots)
    const title = tree?.children?.find(child => child.slot === 'title')
    expect(title?.style).toMatchObject({ fontSize: 4.2, color: '#123456' })
    // Geometry is not styling: it moved to `box` and should not be repeated.
    expect(title?.style).not.toHaveProperty('x')
  })

  it('keeps the order the layout declares, which is the paint order', () => {
    const tree = treeFromPositions(positions, slots)
    expect((tree?.children ?? []).map(child => child.slot)).toEqual([
      'title',
      'body',
      'picture',
    ])
  })

  it('leaves out a slot that was never measured', () => {
    const tree = treeFromPositions(positions, [...slots, { name: 'unplaced' }])
    expect((tree?.children ?? []).map(child => child.slot)).not.toContain(
      'unplaced',
    )
  })

  it('gives nothing back when nothing was measured', () => {
    expect(treeFromPositions({}, slots)).toBeUndefined()
  })
})
