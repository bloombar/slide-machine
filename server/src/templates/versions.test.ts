/**
 * Tests for template content hashing (TMPL-11).
 *
 * The hash decides two things that matter: whether a lecture is told its
 * template moved on, and whether two lectures share one version row. Both go
 * wrong quietly — a hash that is too sensitive invents update notices for
 * edits nobody made, one that is too loose misses a real restructuring.
 */
import { describe, expect, it } from 'vitest'
import { contentHashOf } from './versions'
import type { Layout } from '@slide-machine/shared'

const layout = (over: Partial<Layout> = {}): Layout =>
  ({
    type: 'content',
    label: 'Content',
    purpose: 'A heading and some prose',
    slots: [
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'body', kind: 'text', label: 'Body' },
    ],
    elementPositions: {},
    ...over,
  }) as Layout

const template = (over: Record<string, unknown> = {}) => ({
  name: 'Academic',
  renderMode: 'components' as const,
  theme: { background: '#fff', accent: '#06c' },
  layouts: [layout()],
  ...over,
})

describe('contentHashOf', () => {
  it('is stable across repeated calls', () => {
    expect(contentHashOf(template())).toBe(contentHashOf(template()))
  })

  it('ignores object key order', () => {
    // Mongo does not promise key order across a round trip. If it leaked into
    // the hash, opening a lecture could announce an update nobody made.
    const a = contentHashOf(
      template({ theme: { background: '#fff', accent: '#06c' } }),
    )
    const b = contentHashOf(
      template({ theme: { accent: '#06c', background: '#fff' } }),
    )
    expect(a).toBe(b)
  })

  it('changes when a slot is renamed', () => {
    const renamed = template({
      layouts: [
        layout({
          slots: [
            { name: 'heading', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body' },
          ],
        }),
      ],
    })
    expect(contentHashOf(renamed)).not.toBe(contentHashOf(template()))
  })

  it('changes when a slot is removed', () => {
    const fewer = template({
      layouts: [
        layout({ slots: [{ name: 'title', kind: 'text', label: 'Title' }] }),
      ],
    })
    expect(contentHashOf(fewer)).not.toBe(contentHashOf(template()))
  })

  it('changes when a slot changes kind', () => {
    const recast = template({
      layouts: [
        layout({
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'bullets', label: 'Body' },
          ],
        }),
      ],
    })
    expect(contentHashOf(recast)).not.toBe(contentHashOf(template()))
  })

  it('changes on a purely cosmetic edit too', () => {
    // Deliberate: the notice then reports "available, nothing to adjust",
    // which is true. Guessing which edits "count" would mean sometimes
    // missing one that did.
    const restyled = template({ theme: { background: '#000', accent: '#06c' } })
    expect(restyled).not.toBe(template())
    expect(contentHashOf(restyled)).not.toBe(contentHashOf(template()))
  })

  it('changes when the design changes what it asks the AI for', () => {
    // Changing who a design writes for is a change to the design: a lecture
    // pinned to the old wording should be offered the newer one rather than
    // drifting into it (GEN-11).
    const instructed = template({ aiInstructions: 'Write for nine-year-olds.' })
    expect(contentHashOf(instructed)).not.toBe(contentHashOf(template()))
  })

  it('distinguishes a layout being added', () => {
    const more = template({ layouts: [layout(), layout({ type: 'quote' })] })
    expect(contentHashOf(more)).not.toBe(contentHashOf(template()))
  })
})
