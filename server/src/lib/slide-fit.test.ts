/**
 * Unit tests for slide capacity enforcement: overflowing updates are
 * detected, new-slide content clamps to the layout's word budgets, and
 * promoted updates get a synthesized title.
 */
import { describe, it, expect } from 'vitest'
import type {
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'
import {
  clampToBudget,
  titleFromPhrase,
  updateOverflows,
  wordCount,
} from './slide-fit'

const descriptors: LayoutDescriptor[] = [
  {
    type: 'list',
    label: 'Bullet list',
    purpose: 'points',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      { name: 'bullets', kind: 'bullets', label: 'Slide bullets' },
    ],
    constraints: { maxBullets: 3, maxBulletWords: 4, maxTitleWords: 5 },
  },
  {
    type: 'content',
    label: 'Content',
    purpose: 'general',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      // Per-slot validation (the WYSIWYG form) overrides layout budgets
      { name: 'body', kind: 'text', label: 'Slide body', maxWords: 10 },
    ],
    constraints: { maxTitleWords: 5 },
  },
]

const result = (
  overrides: Partial<SlideGenerationResult>,
): SlideGenerationResult => ({
  action: 'update',
  layoutType: 'list',
  slots: {},
  ...overrides,
})

describe('updateOverflows', () => {
  it('flags bullet overflow against the target layout', () => {
    const r = result({ slots: { bullets: ['one more'] } })
    expect(
      updateOverflows(r, { bulletCount: 3, bodyWords: 0 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 2, bodyWords: 0 }, descriptors),
    ).toBe(false)
  })

  it('flags body word overflow', () => {
    const r = result({
      layoutType: 'content',
      slots: { body: 'six more words of body text' },
    })
    expect(
      updateOverflows(r, { bulletCount: 0, bodyWords: 8 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 0, bodyWords: 2 }, descriptors),
    ).toBe(false)
  })

  it('never flags non-update actions or unconstrained layouts', () => {
    expect(
      updateOverflows(
        result({ action: 'new', slots: { bullets: ['x'] } }),
        { bulletCount: 99, bodyWords: 99 },
        descriptors,
      ),
    ).toBe(false)
  })
})

describe('clampToBudget', () => {
  it('truncates every slot to its word budget', () => {
    const clamped = clampToBudget(
      result({
        action: 'new',
        layoutType: 'list',
        slots: {
          title: 'a very long slide title with too many words',
          bullets: [
            'short one',
            'this bullet has far too many words in it',
            'three',
            'four',
            'five is over the bullet cap',
          ],
        },
      }),
      descriptors,
    )
    expect(clamped.slots.title).toBe('a very long slide title…')
    expect(clamped.slots.bullets).toHaveLength(3)
    expect(clamped.slots.bullets![1]).toBe('this bullet has far…')
  })

  it('leaves content within budget untouched', () => {
    const r = result({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Short', body: 'Fits fine.' },
    })
    expect(clampToBudget(r, descriptors).slots).toEqual(r.slots)
  })
})

describe('per-slot budgets (WYSIWYG form)', () => {
  it('slot-level maxWords overrides the layout constraint', () => {
    // content layout: body budget comes from the SLOT (10), title from
    // the layout constraint (5)
    const clamped = clampToBudget(
      result({
        action: 'new',
        layoutType: 'content',
        slots: {
          title: 'one two three four five six',
          body: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12',
        },
      }),
      descriptors,
    )
    expect(clamped.slots.title).toBe('one two three four five…')
    expect(clamped.slots.body!.split(/\s+/)).toHaveLength(10)

    // updateOverflows consults the same merged budgets
    expect(
      updateOverflows(
        result({ layoutType: 'content', slots: { body: 'a b c' } }),
        { bulletCount: 0, bodyWords: 9 },
        descriptors,
      ),
    ).toBe(true)
  })
})

describe('helpers', () => {
  it('counts words and synthesizes titles from phrases', () => {
    expect(wordCount('  one two   three ')).toBe(3)
    expect(wordCount(undefined)).toBe(0)
    expect(titleFromPhrase('and they also need minerals from the soil')).toBe(
      'And They Also Need Minerals From',
    )
  })
})
