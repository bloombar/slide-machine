/**
 * The layout menu degrades a rung at a time instead of all at once.
 *
 * Going over the budget used to drop every box's authoring instruction
 * (TMPL-10) on the first character of overage. These cover the ladder that
 * replaced it: full instructions, then first sentences, then none.
 */
import { describe, expect, it } from 'vitest'
import { fitLayouts, renderLayouts } from './gemini-generation'

const descriptors = [
  {
    type: 'big-number',
    label: 'Big number',
    purpose: 'One figure the slide exists to frame',
    slots: [
      {
        name: 'figure',
        kind: 'text' as const,
        label: 'The figure',
        description: 'The number alone: "32%", "1.4bn". Never a sentence.',
        maxChars: 8,
        required: true,
      },
      {
        name: 'caption',
        kind: 'text' as const,
        label: 'Caption',
        description:
          'The source, and any qualification a careful reader needs.',
        maxChars: 120,
      },
    ],
  },
]

describe('fitLayouts', () => {
  it('keeps instructions whole when they fit', () => {
    const { menu, detail } = fitLayouts(descriptors, 4000)
    expect(detail).toBe('full')
    expect(menu).toContain(
      'The number alone: "32%", "1.4bn". Never a sentence.',
    )
  })

  it('falls back to first sentences before dropping anything', () => {
    const full = renderLayouts(descriptors, 'full')
    const brief = renderLayouts(descriptors, 'brief')
    expect(brief.length).toBeLessThan(full.length)
    // A budget the full menu misses and the shortened one clears.
    const { menu, detail } = fitLayouts(descriptors, brief.length)
    expect(detail).toBe('brief')
    // The opening sentence survives, its qualifier does not, and nothing is
    // cut mid-sentence.
    expect(menu).toContain('The number alone: "32%", "1.4bn".')
    expect(menu).not.toContain('Never a sentence')
    expect(menu).toContain(
      'The source, and any qualification a careful reader needs.',
    )
  })

  it('drops instructions only when even first sentences will not fit', () => {
    const { menu, detail } = fitLayouts(descriptors, 120)
    expect(detail).toBe('none')
    expect(menu).not.toContain('The number alone')
    // The box's name, kind and limits are never dropped: they are the least
    // the model can work from.
    expect(menu).toContain('figure[text] "The figure" (max 8 chars, required)')
  })

  it('still shortens rather than drops for a realistically long menu', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...descriptors[0]!,
      type: `layout-${i}`,
    }))
    const full = renderLayouts(many, 'full')
    const brief = renderLayouts(many, 'brief')
    const none = renderLayouts(many, 'none')
    expect(none.length).toBeLessThan(brief.length)
    expect(brief.length).toBeLessThan(full.length)
    // A budget between the two: the old all-or-nothing fallback would have
    // dropped every instruction here; the ladder keeps the first sentences.
    const { detail, menu } = fitLayouts(many, brief.length)
    expect(detail).toBe('brief')
    expect(menu.length).toBeLessThanOrEqual(brief.length)
    expect(menu).toContain('The number alone')
  })
})
