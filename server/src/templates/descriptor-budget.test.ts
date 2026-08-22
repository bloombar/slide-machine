/**
 * Every built-in's layout menu must reach the model within the generation
 * prompt's descriptor budget (docs/TEMPLATES.md §3), carrying as much of its
 * authoring guidance (TMPL-10) as will fit.
 *
 * Guarded because of how the budget used to fail. Going over did not trim the
 * overage — the whole menu was re-rendered with no instructions at all, so
 * EVERY box's guidance stopped reaching the model at once, and the only trace
 * was a console warning nobody watches during a live lecture. A template
 * whose instructions are its point kept producing slides, just markedly worse
 * ones.
 *
 * `nyu-elegant` is the template that makes this real: sixteen layouts with an
 * instruction on nearly every box cannot all fit, so it exercises the spend
 * rather than the happy path.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_DESCRIPTOR_CHARS,
  fitLayouts,
  renderLayouts,
} from '../providers/gemini-generation'
import { listBuiltinTemplates, layoutDescriptors } from './builtin'

describe('layout descriptor budget', () => {
  it('fits every built-in menu inside the cap', () => {
    for (const template of listBuiltinTemplates()) {
      const { menu } = fitLayouts(layoutDescriptors(template))
      expect(
        menu.length,
        `${template.id} menu is ${menu.length} chars`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTOR_CHARS)
    }
  })

  it('never gives up a box, only its instruction', () => {
    for (const template of listBuiltinTemplates()) {
      const descriptors = layoutDescriptors(template)
      const { menu } = fitLayouts(descriptors)
      for (const layout of descriptors) {
        expect(menu).toContain(`"${layout.type}"`)
        for (const slot of layout.slots) {
          expect(menu).toContain(`${slot.name}[${slot.kind}`)
        }
      }
    }
  })

  it('spends what it has on the boxes that need telling', () => {
    const template = listBuiltinTemplates().find(t => t.id === 'nyu-elegant')!
    const descriptors = layoutDescriptors(template)
    const full = renderLayouts(descriptors, 'full')
    // The premise: this template genuinely cannot state everything.
    expect(full.length).toBeGreaterThan(MAX_DESCRIPTOR_CHARS)

    const { menu, dropped } = fitLayouts(descriptors)
    expect(dropped).toBeGreaterThan(0)
    // A listing and an expression are what the model cannot infer from a
    // name, so their instructions are the last to go.
    expect(menu).toContain('The listing itself')
    expect(menu).toContain('LaTeX')
    // And the limits are never given up, whatever else is.
    expect(menu).toContain('max 44 chars')
  })
})
