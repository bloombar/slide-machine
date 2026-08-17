/**
 * Unit tests for the preview's stand-in slide, and for the "fill every box to
 * its limit" reading of it (TMPL-4): what the slide holds once every limit is
 * taken at its word. Which limit applies to a box is `slotLimits`, tested in
 * shared/src/types/slot-limits.test.ts.
 */
import { describe, it, expect } from 'vitest'
import type { Layout, LayoutNode, SlotSpec } from '@slide-machine/shared'
import { DEFAULT_TEXT_STYLES, slotLimits } from '@slide-machine/shared'
import { sampleSlide } from './sampleSlide'

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
const points: SlotSpec = { name: 'bullets', kind: 'bullets', label: 'Points' }

describe('sampleSlide at capacity', () => {
  it('fills a text box to exactly its limit', () => {
    const l = layout([title], { constraints: { maxTitleChars: 90 } })
    const slide = sampleSlide(
      l,
      text,
      [],
      'p',
      slotLimits(l, DEFAULT_TEXT_STYLES),
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
      slotLimits(l, DEFAULT_TEXT_STYLES),
    )
    const items = (slide.slots?.bullets as { items: string[] }).items
    expect(items).toHaveLength(5)
    for (const item of items) {
      expect(item.length).toBeLessThanOrEqual(30)
      expect(item.length).toBeGreaterThan(27)
    }
  })

  it('follows the text style a list is set in over the layout’s count', () => {
    // The case the editor's "Default text styles" edits: retuning the bullet
    // style has to change how many points the preview draws.
    const l = layout([points], { constraints: { maxBullets: 6 } }, {
      id: 'root',
      children: [
        { id: 'bullets', slot: 'bullets', style: { textStyle: 'bullet' } },
      ],
    } as LayoutNode)
    const styles = {
      ...DEFAULT_TEXT_STYLES,
      bullet: { ...DEFAULT_TEXT_STYLES.bullet, maxItems: 2, maxChars: 20 },
    }
    const slide = sampleSlide(l, text, [], 'p', slotLimits(l, styles))
    const items = (slide.slots?.bullets as { items: string[] }).items
    expect(items).toHaveLength(2)
    for (const item of items) expect(item.length).toBeLessThanOrEqual(20)
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
      slotLimits(l, DEFAULT_TEXT_STYLES),
    )
    expect((slide.slots?.title as { value: string }).value).toBe('A sli')
  })
})

/**
 * A preview picture has one job: to show where the pictures go. A collage
 * filled with the same photograph does the opposite — the boxes stop reading
 * as separate boxes, which is the thing the preview exists to show.
 */
describe('the pictures a preview puts in a layout', () => {
  const picture = (name: string): SlotSpec => ({
    name,
    kind: 'image',
    label: name,
  })

  const refsFrom = (count: number, pool: string[]): (string | undefined)[] => {
    const slots = Array.from({ length: count }, (_, i) => picture(`p${i}`))
    const slide = sampleSlide(layout(slots), text, pool)
    return slots.map(s => {
      const value = slide.slots?.[s.name]
      return value?.kind === 'image' ? value.ref : undefined
    })
  }

  it('gives every box a different one', () => {
    const pool = Array.from({ length: 12 }, (_, i) => `http://img/${i}.jpg`)
    const refs = refsFrom(6, pool)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('still fills every box when there are fewer pictures than boxes', () => {
    // Repeating beats an empty hole: a blank box reads as a broken preview,
    // where a repeat reads as a placeholder. It only happens when the search
    // came back short.
    const refs = refsFrom(4, ['http://img/only.jpg'])
    expect(refs.every(Boolean)).toBe(true)
  })

  it('leaves the boxes empty when no picture came back at all', () => {
    expect(refsFrom(2, []).every(ref => ref === undefined)).toBe(true)
  })

  /**
   * A design is several layouts, and an author flicks between them. Each one
   * starting at the first picture made every tab show the same photographs:
   * distinct within a slide, repeated across the design.
   */
  describe('across the layouts of one design', () => {
    const refsAt = (start: number, pool: string[]): (string | undefined)[] => {
      const slots = [picture('a'), picture('b')]
      const slide = sampleSlide(
        layout(slots),
        text,
        pool,
        'preview',
        undefined,
        start,
      )
      return slots.map(s => {
        const value = slide.slots?.[s.name]
        return value?.kind === 'image' ? value.ref : undefined
      })
    }

    it('carries the run on, so a later layout shows later pictures', () => {
      const pool = Array.from({ length: 8 }, (_, i) => `http://img/${i}.jpg`)
      const first = refsAt(0, pool)
      const second = refsAt(2, pool)
      expect(new Set([...first, ...second]).size).toBe(4)
    })

    it('comes back round when the design outruns the pool', () => {
      // Unavoidable, and better than an empty box: the pool is finite and a
      // design may hold more picture boxes than it has pictures.
      const pool = ['http://img/0.jpg', 'http://img/1.jpg']
      expect(refsAt(2, pool)).toEqual(pool)
    })
  })
})
