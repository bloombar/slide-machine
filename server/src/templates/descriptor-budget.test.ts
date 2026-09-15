/**
 * Every built-in's layout menu reaches the model in full (TMPL-25), whatever
 * its length against the recommended budget (docs/TEMPLATES.md §3).
 *
 * Guarded because of how the budget used to fail. Going over it did not trim
 * the overage — the whole menu re-rendered with progressively less
 * instruction until it fit, and a template whose instructions could not be
 * shortened enough lost EVERY box's guidance at once, with the only trace a
 * console warning nobody watches during a live lecture. TMPL-25 replaced
 * trimming with sending the menu whole and telling the author instead — this
 * file checks the "whole" half of that never regresses.
 *
 * No shipped design exceeds the recommended budget — `nyu-bold` was the one
 * that did, at 5104 against the 5000 default, until its instruction wording
 * was trimmed to fit (docs/DECISIONS.md). That means the advisory itself is
 * exercised only by client tests and the fixture below, never by a shipped
 * design — stated here rather than implied, since a passing suite cannot say
 * so on its own.
 */
import { describe, expect, it } from 'vitest'
import { descriptorStatus, renderLayouts } from '../providers/gemini-generation'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { listBuiltinTemplates, layoutDescriptors } from './builtin'

describe('layout menu (TMPL-25)', () => {
  const templates = listBuiltinTemplates()

  /**
   * Guards the cases below, which are generated FROM this list.
   *
   * A design that failed to load contributes no case, and a suite that ran
   * fewer cases reports exactly what a suite that passed them all reports —
   * so an empty or short set has to fail as itself, here, rather than being
   * read off a count of zero failures.
   */
  it('is a set worth checking at all', () => {
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
    it(`${template.id} sends every layout, box and instruction whole`, () => {
      const descriptors = layoutDescriptors(template)
      const menu = renderLayouts(descriptors)

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
          // The point of TMPL-25: no box's authoring instruction (TMPL-10) is
          // ever left out for length, so every one an author wrote is here
          // verbatim.
          if (slot.description) {
            expect(
              menu,
              `${template.id} dropped the instruction on "${slot.name}" ` +
                `in "${layout.type}"`,
            ).toContain(slot.description)
          }
        }
      }
    })
  }

  it('no shipped design exceeds the recommended budget', () => {
    // The real guarantee: an author never meets an unactionable advisory on
    // a built-in they cannot edit. This fails loudly the day a future design
    // edit pushes one over, rather than resting on any one template's margin.
    for (const template of templates) {
      const status = descriptorStatus(layoutDescriptors(template))
      expect(
        status.overBudget,
        `${template.id} measures ${status.length} against a ${status.max} budget`,
      ).toBe(false)
    }
  })
})
