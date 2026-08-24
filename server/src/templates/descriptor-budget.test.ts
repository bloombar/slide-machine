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
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { listBuiltinTemplates, layoutDescriptors } from './builtin'

describe('layout descriptor budget', () => {
  const templates = listBuiltinTemplates()

  /**
   * Guards the cases below, which are generated FROM this list.
   *
   * A design that failed to load contributes no case, and a suite that ran
   * fewer cases reports exactly what a suite that passed them all reports —
   * so an empty or short set has to fail as itself, here, rather than being
   * read off a count of zero failures.
   */
  it('is a set worth budgeting at all', () => {
    expect(templates.length).toBeGreaterThan(0)
    for (const template of templates)
      expect(
        template.layouts.length,
        `${template.id} has no layouts`,
      ).toBeGreaterThan(0)
  })

  for (const template of templates) {
    /*
     * Titled per design rather than looped inside one case, which is the
     * whole point of the shape.
     *
     * Iterating every built-in inside a single `it` means a design that never
     * loaded is not skipped, not failed, and not mentioned: the loop simply
     * turns fewer times and the one case still goes green. The title below is
     * the evidence that THIS design was measured — a thing a reader can look
     * for by name in the output, rather than infer from another suite.
     */
    it(`${template.id} fits its menu inside the cap`, () => {
      const { menu } = fitLayouts(layoutDescriptors(template))
      expect(
        menu.length,
        `${template.id} menu is ${menu.length} chars, over the ` +
          `${MAX_DESCRIPTOR_CHARS} cap — going over drops EVERY box's ` +
          `instruction at once, not just the overage`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTOR_CHARS)
    })

    it(`${template.id} gives up instructions but never a box`, () => {
      const descriptors = layoutDescriptors(template)
      const { menu } = fitLayouts(descriptors)
      /*
       * The premise of the case: the menu describes the layouts generation
       * can actually choose, and all of them.
       *
       * Stated as which types are present rather than as a count. A count
       * has to know that `layoutDescriptors` withholds the whiteboard — that
       * withholding IS the mechanism by which generation never selects it —
       * and a count that forgets is off by one against every design at once,
       * which reads as the newest template having broken the suite. Naming
       * the types says what is meant and has no arithmetic to get wrong.
       */
      const described = descriptors.map(layout => layout.type)
      expect(
        described,
        `${template.id} offered the blank slate to the generator`,
      ).not.toContain(WHITEBOARD_LAYOUT_TYPE)
      expect([...described].sort()).toEqual(
        template.layouts
          .map(layout => layout.type)
          .filter(type => type !== WHITEBOARD_LAYOUT_TYPE)
          .sort(),
      )
      for (const layout of descriptors) {
        expect(
          menu,
          `${template.id} dropped layout "${layout.type}"`,
        ).toContain(`"${layout.type}"`)
        for (const slot of layout.slots) {
          expect(
            menu,
            `${template.id} dropped box "${slot.name}" from "${layout.type}"`,
          ).toContain(`${slot.name}[${slot.kind}`)
        }
      }
    })
  }

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
