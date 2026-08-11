/**
 * Unit tests for the prompt that names imported layouts (TMPL-8 pass 5).
 *
 * Two properties carry the pass: the model must see every layout together so
 * it can reuse a name across them, and it must be asked for names only — never
 * geometry, which is the one way a wrong answer could break a template.
 */
import { describe, it, expect } from 'vitest'
import type { ImportedLayoutDescriptor } from '@slide-machine/shared'
import {
  importSemanticsPrompt,
  LAYOUT_VOCABULARY,
} from './import-semantics-prompt'

const descriptor = (
  over: Partial<ImportedLayoutDescriptor> = {},
): ImportedLayoutDescriptor => ({
  slideCount: 4,
  slots: [
    {
      name: 'title',
      kind: 'text',
      box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
      fontSize: 5,
    },
    {
      name: 'body',
      kind: 'bullets',
      box: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
    },
  ],
  ...over,
})

describe('what the model is asked', () => {
  it('describes every box, with what it holds and where it sits', () => {
    const prompt = importSemanticsPrompt([descriptor()])
    expect(prompt).toContain('title (text)')
    expect(prompt).toContain('body (bullets)')
    expect(prompt).toContain('8,10 84x18')
    expect(prompt).toContain('5.0cqi')
  })

  it('says how many slides shared each design', () => {
    expect(importSemanticsPrompt([descriptor()])).toContain('4 slide(s)')
  })

  it('shows every layout in one call, so a name can be reused across them', () => {
    // A model that sees layouts one at a time cannot merge near-duplicates
    const prompt = importSemanticsPrompt([descriptor(), descriptor()])
    expect(prompt).toContain('Layout 1')
    expect(prompt).toContain('Layout 2')
  })

  it('offers the conventional names as a preference', () => {
    const prompt = importSemanticsPrompt([descriptor()])
    for (const name of LAYOUT_VOCABULARY) expect(prompt).toContain(name)
    expect(prompt.toLowerCase()).toContain('reuse the same name')
    expect(prompt.toLowerCase()).toContain('invent a name only when')
  })

  it('asks for names and sentences, never for a box', () => {
    const prompt = importSemanticsPrompt([descriptor()])
    expect(prompt).toMatch(/Return JSON: \{"layouts"/)
    expect(prompt).not.toMatch(/return .*(box|coordinate)/i)
  })

  it('notes bold, which is how a title reads as one', () => {
    const prompt = importSemanticsPrompt([
      descriptor({
        slots: [
          {
            name: 'title',
            kind: 'text',
            box: { x: 0, y: 0, w: 1, h: 0.2 },
            bold: true,
          },
        ],
      }),
    ])
    expect(prompt).toContain(', bold')
  })

  it('leaves out a type size nobody stated rather than inventing one', () => {
    const prompt = importSemanticsPrompt([
      descriptor({
        slots: [
          { name: 'title', kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } },
        ],
      }),
    ])
    expect(prompt).not.toContain('cqi')
  })
})
