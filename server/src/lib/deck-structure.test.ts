/**
 * Unit tests for the deck-structure context builder (live section awareness):
 * outline + positional signals derived from heading slides and the deck order.
 */
import { describe, it, expect } from 'vitest'
import { listBuiltinTemplates, layoutDescriptors } from '../templates/builtin'
import { buildDeckStructure, headerLayoutTypes } from './deck-structure'

const descriptors = layoutDescriptors(listBuiltinTemplates()[0]!)

describe('headerLayoutTypes', () => {
  it('lists the template heading layouts (title/section) only', () => {
    const types = headerLayoutTypes(descriptors)
    expect(types).toContain('title')
    expect(types).toContain('section')
    expect(types).not.toContain('content')
    expect(types).not.toContain('list')
    expect(types).not.toContain('whiteboard')
  })
})

describe('buildDeckStructure', () => {
  // order: title(0), content, content, section(3), content
  const order = ['t', 'c1', 'c2', 's', 'c3']
  const headings = [
    { id: 's', layoutType: 'section' as const, title: 'Adding Fractions' },
    { id: 't', layoutType: 'title' as const, title: 'Fractions' },
  ]

  it('orders the outline by slide position and 1-indexes it', () => {
    const structure = buildDeckStructure(headings, order)
    expect(structure.outline).toEqual([
      { position: 1, layoutType: 'title', title: 'Fractions' },
      { position: 4, layoutType: 'section', title: 'Adding Fractions' },
    ])
  })

  it('reports totals, slides-since-heading, and an opening title slide', () => {
    const structure = buildDeckStructure(headings, order)
    expect(structure.totalSlides).toBe(5)
    // last heading at position 3 (section); one slide (c3) follows it.
    expect(structure.slidesSinceHeader).toBe(1)
    expect(structure.hasTitleSlide).toBe(true)
  })

  it('counts every slide as since-heading when there are no headings', () => {
    const structure = buildDeckStructure([], ['a', 'b', 'c'])
    expect(structure.slidesSinceHeader).toBe(3)
    expect(structure.hasTitleSlide).toBe(false)
    expect(structure.outline).toEqual([])
  })

  it('drops headings not present in the slide order and defaults a missing title', () => {
    const structure = buildDeckStructure(
      [
        { id: 'ghost', layoutType: 'section', title: 'Gone' },
        { id: 'x', layoutType: 'section' },
      ],
      ['x', 'y'],
    )
    // 'ghost' is absent from the order, so it's dropped; 'x' keeps an empty title.
    expect(structure.outline).toEqual([
      { position: 1, layoutType: 'section', title: '' },
    ])
    // A heading at position 0 means the deck has opened with an intro slide —
    // the "don't create another opening slide" signal.
    expect(structure.hasTitleSlide).toBe(true)
  })
})
