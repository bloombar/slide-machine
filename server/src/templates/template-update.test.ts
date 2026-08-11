/**
 * Tests for the template-update plan and its warning (TMPL-11).
 *
 * The promise the confirmation dialog makes is that content which pairs with
 * nothing is left on the slide rather than deleted, and that the boxes it
 * names are the boxes that actually go dark. Both are checked here, along
 * with the quieter half: a layout the lecture does not use, or a box no slide
 * fills, must not raise a warning at all.
 */
import { describe, expect, it } from 'vitest'
import {
  planTemplateSwitch,
  planUpdate,
  slotHasContent,
} from './template-update'
import type { Layout, SlotValue } from '@slide-machine/shared'

const layout = (type: string, slots: [string, string][]): Layout =>
  ({
    type,
    label: type,
    purpose: type,
    slots: slots.map(([name, kind]) => ({
      name,
      kind,
      label: name[0]!.toUpperCase() + name.slice(1),
    })),
    elementPositions: {},
  }) as Layout

describe('slotHasContent', () => {
  it('is false for an absent or empty box', () => {
    expect(slotHasContent(undefined)).toBe(false)
    expect(slotHasContent({ kind: 'text', value: '   ' })).toBe(false)
    expect(slotHasContent({ kind: 'bullets', items: ['', ' '] })).toBe(false)
    expect(slotHasContent({ kind: 'image' })).toBe(false)
    expect(slotHasContent({ kind: 'table', rows: [['', '']] })).toBe(false)
  })

  it('is true for a box holding anything at all', () => {
    expect(slotHasContent({ kind: 'text', value: 'Hi' })).toBe(true)
    expect(slotHasContent({ kind: 'bullets', items: ['', 'x'] })).toBe(true)
    expect(slotHasContent({ kind: 'image', ref: 'x.png' })).toBe(true)
    expect(slotHasContent({ kind: 'code', source: 'print(1)' })).toBe(true)
    expect(slotHasContent({ kind: 'math', tex: 'x^2' })).toBe(true)
    expect(slotHasContent({ kind: 'table', rows: [['a']] })).toBe(true)
  })
})

describe('planUpdate', () => {
  it('pairs boxes that kept their name', () => {
    const from = {
      layouts: [
        layout('content', [
          ['title', 'text'],
          ['body', 'text'],
        ]),
      ],
    }
    const to = {
      layouts: [
        layout('content', [
          ['title', 'text'],
          ['body', 'text'],
        ]),
      ],
    }
    const plan = planUpdate(from, to, ['content'])
    expect(plan.get('content')).toEqual({
      pairs: { title: 'title', body: 'body' },
      unmatchedFrom: [],
      layoutRemoved: false,
    })
  })

  it('pairs a renamed box onto one of the same kind', () => {
    const from = { layouts: [layout('content', [['body', 'text']])] }
    const to = { layouts: [layout('content', [['prose', 'text']])] }
    expect(planUpdate(from, to, ['content']).get('content')?.pairs).toEqual({
      body: 'prose',
    })
  })

  it('reports a box with nowhere to go', () => {
    const from = {
      layouts: [
        layout('content', [
          ['title', 'text'],
          ['sources', 'text'],
        ]),
      ],
    }
    const to = { layouts: [layout('content', [['title', 'text']])] }
    const plan = planUpdate(from, to, ['content'])
    expect(plan.get('content')?.unmatchedFrom).toEqual(['sources'])
  })

  it('refuses to pair a name whose kind changed', () => {
    // Putting prose into a box only a picture editor can open would strand it
    // somewhere the user cannot reach.
    const from = { layouts: [layout('content', [['body', 'text']])] }
    const to = { layouts: [layout('content', [['body', 'image']])] }
    const plan = planUpdate(from, to, ['content'])
    expect(plan.get('content')?.pairs).toEqual({})
    expect(plan.get('content')?.unmatchedFrom).toEqual(['body'])
  })

  it('flags a layout the update removes', () => {
    const from = { layouts: [layout('quote', [['quote', 'text']])] }
    const to = { layouts: [layout('content', [['title', 'text']])] }
    expect(planUpdate(from, to, ['quote']).get('quote')).toEqual({
      pairs: {},
      unmatchedFrom: [],
      layoutRemoved: true,
    })
  })

  it('ignores layouts the lecture does not use', () => {
    const from = {
      layouts: [
        layout('content', [['title', 'text']]),
        layout('quote', [['quote', 'text']]),
      ],
    }
    const to = { layouts: [layout('content', [['title', 'text']])] }
    // 'quote' vanished, but no slide is on it, so it is not in the plan.
    const plan = planUpdate(from, to, ['content'])
    expect(plan.has('quote')).toBe(false)
    expect(plan.get('content')?.unmatchedFrom).toEqual([])
  })

  it('skips a layout the pinned version never had', () => {
    const from = { layouts: [layout('content', [['title', 'text']])] }
    const to = { layouts: [layout('content', [['title', 'text']])] }
    expect(planUpdate(from, to, ['mystery']).has('mystery')).toBe(false)
  })
})

describe('the pairing is the same one the slide switch uses', () => {
  it('carries content by name first and kind second', () => {
    // Two text boxes, one renamed and one kept: the kept name must win its
    // partner outright rather than being taken by declaration order.
    const from = {
      layouts: [
        layout('content', [
          ['body', 'text'],
          ['title', 'text'],
        ]),
      ],
    }
    const to = {
      layouts: [
        layout('content', [
          ['title', 'text'],
          ['prose', 'text'],
        ]),
      ],
    }
    const pairs = planUpdate(from, to, ['content']).get('content')?.pairs
    expect(pairs).toEqual({ title: 'title', body: 'prose' })
  })
})

/**
 * Moving a lecture onto a DIFFERENT design (TMPL-8): the case an imported
 * template creates. It names its layouts after whatever its slides turned out
 * to be, so there is no type in common to key on and the slides have to be
 * placed rather than matched.
 */
describe('planTemplateSwitch', () => {
  const slide = (
    id: string,
    layoutType: string,
    slots: Record<string, SlotValue>,
  ) => ({ id, layoutType, slots })

  const text = (value: string): SlotValue => ({ kind: 'text', value })

  const CLASSIC = {
    layouts: [
      layout('title', [['title', 'text']]),
      layout('content', [
        ['title', 'text'],
        ['body', 'text'],
      ]),
    ],
  }

  it('keeps a slide on a layout of the same type when the design has one', () => {
    // Two templates that both name a layout "content" mean the same thing
    const imported = {
      layouts: [
        layout('content', [
          ['title', 'text'],
          ['body', 'text'],
        ]),
      ],
    }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'content', { title: text('Runoff'), body: text('Water') }),
    ])
    expect(plans.get('s1')).toEqual({
      layoutType: 'content',
      pairs: { title: 'title', body: 'body' },
      unmatchedFrom: [],
    })
  })

  it('places a slide on the imported layout that carries the most of it', () => {
    // The reported bug: an imported design's layouts are called whatever its
    // slides were, so nothing matches by type and the lecture went blank
    const imported = {
      layouts: [
        layout('cover', [['heading', 'text']]),
        layout('statement-and-detail', [
          ['heading', 'text'],
          ['detail', 'text'],
        ]),
      ],
    }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'content', { title: text('Runoff'), body: text('Water') }),
    ])
    expect(plans.get('s1')?.layoutType).toBe('statement-and-detail')
    // Both boxes travel, under the names the imported design uses
    expect(Object.keys(plans.get('s1')!.pairs)).toHaveLength(2)
  })

  it('does not let empty boxes vote for a bigger layout', () => {
    // A slide with a title and nothing else belongs on a title card
    const imported = {
      layouts: [
        layout('cover', [['heading', 'text']]),
        layout('detailed', [
          ['heading', 'text'],
          ['detail', 'text'],
        ]),
      ],
    }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'content', { title: text('Runoff'), body: text('  ') }),
    ])
    expect(plans.get('s1')?.layoutType).toBe('cover')
  })

  it('leaves content that pairs with nothing on the slide', () => {
    // Nothing is deleted by a switch: switching back finds it intact, and the
    // GEN-9 re-fit reads it as the source for the boxes the move left empty
    const imported = { layouts: [layout('cover', [['heading', 'text']])] }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'content', { title: text('Runoff'), body: text('Water') }),
    ])
    expect(plans.get('s1')?.unmatchedFrom).toEqual(['body'])
  })

  it('skips a slide whose old layout the design never declared', () => {
    // No boxes to pair, so moving its content would be a guess on no evidence
    const imported = { layouts: [layout('cover', [['heading', 'text']])] }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'whiteboard', {}),
    ])
    expect(plans.get('s1')).toBeUndefined()
  })

  it('leaves a slide on a layout with no boxes where it is', () => {
    // A freehand whiteboard canvas: nothing to pair, so any layout this chose
    // would be a guess on no evidence
    const withBoard = {
      layouts: [...CLASSIC.layouts, layout('whiteboard', [])],
    }
    const imported = { layouts: [layout('cover', [['heading', 'text']])] }
    const plans = planTemplateSwitch(withBoard, imported, [
      slide('s1', 'whiteboard', {}),
    ])
    expect(plans.get('s1')).toBeUndefined()
  })

  it('plans nothing at all for a design with no layouts', () => {
    const plans = planTemplateSwitch(CLASSIC, { layouts: [] }, [
      slide('s1', 'content', { title: text('Runoff') }),
    ])
    expect(plans.size).toBe(0)
  })

  it('breaks a tie toward the layout that leaves fewest boxes empty', () => {
    const imported = {
      layouts: [
        layout('roomy', [
          ['heading', 'text'],
          ['detail', 'text'],
          ['aside', 'text'],
        ]),
        layout('snug', [
          ['heading', 'text'],
          ['detail', 'text'],
        ]),
      ],
    }
    const plans = planTemplateSwitch(CLASSIC, imported, [
      slide('s1', 'content', { title: text('Runoff'), body: text('Water') }),
    ])
    expect(plans.get('s1')?.layoutType).toBe('snug')
  })
})
