/**
 * Unit tests for how much each box of a layout may hold: which of the three
 * places a limit can be written wins, and what is left unbounded.
 */
import { describe, it, expect } from 'vitest'
import { slotLimits, limitsFor } from './slot-limits'
import { DEFAULT_TEXT_STYLES } from './text-styles'
import type { Layout, LayoutNode, SlotSpec } from './template'

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

/** The same layout with each box set in a named text style. */
const styled = (
  slots: SlotSpec[],
  roles: Record<string, string>,
  over: Partial<Layout> = {},
): Layout =>
  layout(slots, over, {
    id: 'root',
    container: { mode: 'flex', direction: 'column', gap: 3 },
    children: slots.map(s => ({
      id: s.name,
      slot: s.name,
      style: { textStyle: roles[s.name] },
    })),
  } as LayoutNode)

const title: SlotSpec = { name: 'title', kind: 'text', label: 'Slide title' }
const body: SlotSpec = { name: 'body', kind: 'text', label: 'Slide body' }
const points: SlotSpec = { name: 'bullets', kind: 'bullets', label: 'Points' }

describe('slotLimits', () => {
  it('takes the box’s own limit over everything else', () => {
    const l = styled(
      [{ ...title, maxChars: 12 }],
      { title: 'heading' },
      {
        constraints: { maxTitleChars: 60 },
      },
    )
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).title?.maxChars).toBe(12)
  })

  it('takes the text style over the layout’s constraint', () => {
    // The style is what the editor's "Default text styles" edits, so retuning
    // it has to move the box; the constraint is written into the template file
    // and no editor shows it.
    const l = styled(
      [title],
      { title: 'heading' },
      {
        constraints: { maxTitleChars: 50 },
      },
    )
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).title?.maxChars).toBe(
      DEFAULT_TEXT_STYLES.heading!.maxChars,
    )
  })

  it('takes the bullet style’s count over the layout’s maxBullets', () => {
    const l = styled(
      [points],
      { bullets: 'bullet' },
      {
        constraints: { maxBullets: 6, maxBulletChars: 70 },
      },
    )
    const styles = {
      ...DEFAULT_TEXT_STYLES,
      bullet: { maxChars: 40, maxItems: 3 },
    }
    expect(slotLimits(l, styles).bullets).toEqual({ maxChars: 40, maxItems: 3 })
  })

  it('falls back to the layout’s constraint for a box in no style', () => {
    const l = layout([title, body], {
      constraints: { maxTitleChars: 40, maxBodyChars: 200 },
    })
    const limits = slotLimits(l, DEFAULT_TEXT_STYLES)
    expect(limits.title?.maxChars).toBe(40)
    expect(limits.body?.maxChars).toBe(200)
  })

  it('counts a list’s points as well as its characters', () => {
    const l = layout([points], {
      constraints: { maxBullets: 5, maxBulletChars: 30 },
    })
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).bullets).toEqual({
      maxChars: 30,
      maxItems: 5,
    })
  })

  it('lets a list box say how many points it holds', () => {
    const l = layout([{ ...points, maxItems: 8 }], {
      constraints: { maxBullets: 5 },
    })
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).bullets?.maxItems).toBe(8)
  })

  it('counts no points for a box that is not a list', () => {
    const l = layout([title], { constraints: { maxBullets: 5 } })
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).title?.maxItems).toBeUndefined()
  })

  it('reads the style of an imported design’s bare geometry', () => {
    // No tree at all (TMPL-8): the box names its style in elementPositions.
    const l = layout([{ name: 'note', kind: 'text', label: 'Note' }], {
      tree: undefined,
      elementPositions: {
        note: { x: 0, y: 0, w: 1, h: 0.3, textStyle: 'caption' },
      },
    } as Partial<Layout>)
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).note?.maxChars).toBe(
      DEFAULT_TEXT_STYLES.caption!.maxChars,
    )
  })

  it('leaves a box nothing bounds out', () => {
    const l = layout([{ name: 'note', kind: 'text', label: 'Note' }])
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).note).toBeUndefined()
  })

  it('bounds no picture', () => {
    const l = layout([{ name: 'image', kind: 'image', label: 'Picture' }], {
      constraints: { maxTitleChars: 40 },
    })
    expect(slotLimits(l, DEFAULT_TEXT_STYLES).image).toBeUndefined()
  })
})

describe('limitsFor', () => {
  it('answers for one box whose style the caller already knows', () => {
    expect(
      limitsFor(
        points,
        { constraints: { maxBullets: 9 } },
        DEFAULT_TEXT_STYLES,
        'bullet',
      ),
    ).toEqual({
      maxChars: DEFAULT_TEXT_STYLES.bullet!.maxChars,
      maxItems: DEFAULT_TEXT_STYLES.bullet!.maxItems,
    })
  })

  it('holds a box in no style to the layout’s constraint', () => {
    expect(
      limitsFor(
        title,
        { constraints: { maxTitleChars: 44 } },
        DEFAULT_TEXT_STYLES,
        undefined,
      ),
    ).toEqual({ maxChars: 44, maxItems: undefined })
  })
})
