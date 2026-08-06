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
import { planUpdate, slotHasContent } from './template-update'
import type { Layout } from '@slide-machine/shared'

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
