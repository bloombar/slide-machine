/**
 * Unit tests for slide capacity enforcement: overflowing updates are
 * detected, new-slide content clamps to the layout's character
 * budgets (word-boundary cuts for spaced text, hard cuts for CJK),
 * and promoted updates get a synthesized title.
 */
import { describe, it, expect } from 'vitest'
import type {
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'
import {
  charCount,
  clampToBudget,
  titleFromPhrase,
  updateOverflows,
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
    constraints: { maxBullets: 3, maxBulletChars: 20, maxTitleChars: 25 },
  },
  {
    type: 'content',
    label: 'Content',
    purpose: 'general',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      // Per-slot validation (the WYSIWYG form) overrides layout budgets
      { name: 'body', kind: 'text', label: 'Slide body', maxChars: 40 },
    ],
    constraints: { maxTitleChars: 25 },
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
      updateOverflows(r, { bulletCount: 3, bodyChars: 0 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 2, bodyChars: 0 }, descriptors),
    ).toBe(false)
  })

  it('flags body character overflow', () => {
    const r = result({
      layoutType: 'content',
      // 28 chars: overflows a 40-char budget once 20 are used, not 5
      slots: { body: 'six more words of body text.' },
    })
    expect(
      updateOverflows(r, { bulletCount: 0, bodyChars: 20 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 0, bodyChars: 5 }, descriptors),
    ).toBe(false)
  })

  it('never flags non-update actions or unconstrained layouts', () => {
    expect(
      updateOverflows(
        result({ action: 'new', slots: { bullets: ['x'] } }),
        { bulletCount: 99, bodyChars: 999 },
        descriptors,
      ),
    ).toBe(false)
  })
})

describe('clampToBudget', () => {
  it('truncates every slot to its character budget at a word boundary', () => {
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
    // 25-char title budget, cut at the last space inside it
    expect(clamped.slots.title).toBe('a very long slide title…')
    expect(clamped.slots.bullets).toHaveLength(3)
    // 20-char bullet budget
    expect(clamped.slots.bullets![1]).toBe('this bullet has far…')
  })

  it('hard-cuts unspaced text (CJK) at the budget', () => {
    // 28 chars, no spaces — nothing word-based could measure this
    const zh = '光合作用是植物利用光能把二氧化碳和水合成有机物的过程机制'
    const clamped = clampToBudget(
      result({ action: 'new', layoutType: 'content', slots: { title: zh } }),
      descriptors,
    )
    // 25-char title budget with no space to cut at
    expect(clamped.slots.title).toBe(`${zh.slice(0, 25)}…`)
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
  it('slot-level maxChars overrides the layout constraint', () => {
    // content layout: body budget comes from the SLOT (40 chars),
    // title from the layout constraint (25 chars)
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
    expect(clamped.slots.body!.length).toBeLessThanOrEqual(40)

    // updateOverflows consults the same merged budgets
    expect(
      updateOverflows(
        result({ layoutType: 'content', slots: { body: 'twelve chars' } }),
        { bulletCount: 0, bodyChars: 30 },
        descriptors,
      ),
    ).toBe(true)
  })
})

describe('helpers', () => {
  it('counts characters and synthesizes titles from phrases', () => {
    expect(charCount('  one two   three ')).toBe(15)
    expect(charCount('光合作用')).toBe(4)
    expect(charCount(undefined)).toBe(0)
    expect(titleFromPhrase('and they also need minerals from the soil')).toBe(
      'And They Also Need Minerals From',
    )
  })
})
