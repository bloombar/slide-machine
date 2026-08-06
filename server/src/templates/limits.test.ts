/**
 * The budgets a box carries into generation.
 *
 * A limit is only worth having if the model is told it and the server trims
 * to it. These check the chain end to end: a box that states nothing inherits
 * its text style's budget, a box that states something overrides it, and both
 * arrive in the descriptor the prompt is built from.
 */
import { describe, it, expect } from 'vitest'
import type { Template } from '@slide-machine/shared'
import { layoutDescriptors } from './builtin'

const template = (over: Partial<Template> = {}): Template =>
  ({
    id: 't',
    ownerId: 'u',
    name: 'T',
    theme: {},
    visibility: 'private',
    voteScore: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    layouts: [
      {
        type: 'content',
        label: 'Content',
        purpose: 'prose',
        slots: [
          { name: 'title', kind: 'text', label: 'Title' },
          { name: 'points', kind: 'bullets', label: 'Points' },
        ],
        tree: {
          id: 'root',
          container: { mode: 'flex', direction: 'column' },
          children: [
            { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
            { id: 'points', slot: 'points', style: { textStyle: 'bullet' } },
          ],
        },
        elementPositions: {},
      },
    ],
    ...over,
  }) as Template

const contentOf = (t: Template) =>
  layoutDescriptors(t).find(d => d.type === 'content')!

describe('limits reaching the model', () => {
  it('gives a box the budget of the style it follows', () => {
    const slots = contentOf(template()).slots
    expect(slots.find(s => s.name === 'title')?.maxChars).toBe(80)
    expect(slots.find(s => s.name === 'points')?.maxChars).toBe(90)
  })

  it('counts a bullet list’s points as the layout’s limit', () => {
    // The prompt and the trimmer both read maxBullets, so a per-box count
    // has to arrive there or it would never be applied.
    expect(contentOf(template()).constraints?.maxBullets).toBe(6)
  })

  it('lets the template change what a style allows', () => {
    const t = template({ theme: { textStyles: { heading: { maxChars: 40 } } } })
    expect(contentOf(t).slots.find(s => s.name === 'title')?.maxChars).toBe(40)
  })

  it('lets one box override the style it follows', () => {
    const t = template()
    t.layouts[0]!.slots[0]!.maxChars = 25
    expect(contentOf(t).slots.find(s => s.name === 'title')?.maxChars).toBe(25)
  })

  it('lets a style outrank the layout’s own constraint', () => {
    // The style is the one an author can edit; the constraint is written into
    // the template file. The editor's preview resolves it the same way, so
    // what a design is drawn at is what it is generated at.
    const t = template({
      theme: {
        textStyles: { heading: { maxChars: 40 }, bullet: { maxItems: 3 } },
      },
    })
    t.layouts[0]!.constraints = { maxTitleChars: 50, maxBullets: 6 }
    const d = contentOf(t)
    expect(d.slots.find(s => s.name === 'title')?.maxChars).toBe(40)
    expect(d.constraints?.maxBullets).toBe(3)
  })

  it('holds a box in no style to the layout’s constraint', () => {
    const t = template()
    delete t.layouts[0]!.tree!.children![0]!.style
    t.layouts[0]!.constraints = { maxTitleChars: 50 }
    expect(contentOf(t).slots.find(s => s.name === 'title')?.maxChars).toBe(50)
  })

  it('leaves a box following no style without an invented budget', () => {
    const t = template()
    delete t.layouts[0]!.tree!.children![0]!.style
    expect(
      contentOf(t).slots.find(s => s.name === 'title')?.maxChars,
    ).toBeUndefined()
  })
})
