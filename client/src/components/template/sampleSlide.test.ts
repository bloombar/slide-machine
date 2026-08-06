/**
 * Unit tests for the preview's stand-in slide, and for the "fill every box to
 * its limit" reading of it (TMPL-4): which limit applies to a box, and what
 * the slide holds once every one of them is taken at its word.
 */
import { describe, it, expect } from 'vitest'
import type { Layout, LayoutNode, SlotSpec } from '@slide-machine/shared'
import { DEFAULT_TEXT_STYLES } from '@slide-machine/shared'
import { sampleSlide, slotBudgets } from './sampleSlide'

const text = {
  title: 'A slide in this style',
  body: 'A sentence or two of body text.',
  caption: 'A caption',
  bullets: ['A first point', 'A second point', 'A third point'],
}

const layout = (
  slots: SlotSpec[],
  over: Partial<Layout> = {},
  tree?: LayoutNode,
): Layout =>
  ({
    type: 'content',
    label: 'Content',
    purpose: 'use for content',
    slots,
    tree: tree ?? {
      id: 'root',
      container: { mode: 'flex', direction: 'column', gap: 3 },
      children: slots.map(s => ({ id: s.name, slot: s.name })),
    },
    elementPositions: {},
    ...over,
  }) as Layout

const title: SlotSpec = { name: 'title', kind: 'text', label: 'Slide title' }
const body: SlotSpec = { name: 'body', kind: 'text', label: 'Slide body' }
const points: SlotSpec = { name: 'bullets', kind: 'bullets', label: 'Points' }

describe('slotBudgets', () => {
  it('takes the box’s own limit over everything else', () => {
    const l = layout([{ ...title, maxChars: 12 }], {
      constraints: { maxTitleChars: 60 },
    })
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).title?.chars).toBe(12)
  })

  it('falls back to the layout’s constraint for a conventional box', () => {
    const l = layout([title, body], {
      constraints: { maxTitleChars: 40, maxBodyChars: 200 },
    })
    const budgets = slotBudgets(l, DEFAULT_TEXT_STYLES)
    expect(budgets.title?.chars).toBe(40)
    expect(budgets.body?.chars).toBe(200)
  })

  it('falls back to the text style the box is set in', () => {
    // Nothing else says how much fits, but the box is set in `caption`
    const l = layout([{ name: 'note', kind: 'text', label: 'Note' }], {}, {
      id: 'root',
      children: [{ id: 'note', slot: 'note', style: { textStyle: 'caption' } }],
    } as LayoutNode)
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).note?.chars).toBe(
      DEFAULT_TEXT_STYLES.caption!.maxChars,
    )
  })

  it('leaves a box nothing bounds without a budget', () => {
    const l = layout([{ name: 'note', kind: 'text', label: 'Note' }])
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).note).toBeUndefined()
  })

  it('counts a list’s points as well as its characters', () => {
    const l = layout([points], {
      constraints: { maxBullets: 5, maxBulletChars: 30 },
    })
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).bullets).toEqual({
      chars: 30,
      items: 5,
    })
  })

  it('lets a list box say how many points it holds', () => {
    const l = layout([{ ...points, maxItems: 8 }], {
      constraints: { maxBullets: 5 },
    })
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).bullets?.items).toBe(8)
  })

  it('bounds no picture', () => {
    const l = layout([{ name: 'image', kind: 'image', label: 'Picture' }], {
      constraints: { maxTitleChars: 40 },
    })
    expect(slotBudgets(l, DEFAULT_TEXT_STYLES).image).toBeUndefined()
  })
})

describe('sampleSlide at capacity', () => {
  it('fills a text box to exactly its limit', () => {
    const l = layout([title], { constraints: { maxTitleChars: 90 } })
    const slide = sampleSlide(
      l,
      text,
      [],
      'p',
      slotBudgets(l, DEFAULT_TEXT_STYLES),
    )
    const value = (slide.slots?.title as { value: string }).value
    // Filled to the budget, give or take a trailing space the cut dropped
    expect(value.length).toBeLessThanOrEqual(90)
    expect(value.length).toBeGreaterThan(87)
    expect(value.startsWith(text.title)).toBe(true)
  })

  it('gives a list as many points as it holds, each at its limit', () => {
    const l = layout([points], {
      constraints: { maxBullets: 5, maxBulletChars: 30 },
    })
    const slide = sampleSlide(
      l,
      text,
      [],
      'p',
      slotBudgets(l, DEFAULT_TEXT_STYLES),
    )
    const items = (slide.slots?.bullets as { items: string[] }).items
    expect(items).toHaveLength(5)
    for (const item of items) {
      expect(item.length).toBeLessThanOrEqual(30)
      expect(item.length).toBeGreaterThan(27)
    }
  })

  it('leaves the sample alone without budgets', () => {
    const l = layout([title, points], {
      constraints: { maxTitleChars: 90, maxBullets: 5 },
    })
    const slide = sampleSlide(l, text)
    expect((slide.slots?.title as { value: string }).value).toBe(text.title)
    expect((slide.slots?.bullets as { items: string[] }).items).toEqual(
      text.bullets,
    )
  })

  it('never shortens what already fits', () => {
    // A limit longer than the sample grows it; one shorter still fills the
    // box exactly, which is the point of looking.
    const l = layout([{ ...title, maxChars: 5 }])
    const slide = sampleSlide(
      l,
      text,
      [],
      'p',
      slotBudgets(l, DEFAULT_TEXT_STYLES),
    )
    expect((slide.slots?.title as { value: string }).value).toBe('A sli')
  })
})
