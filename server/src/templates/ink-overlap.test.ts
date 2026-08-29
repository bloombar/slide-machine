/**
 * Whether two boxes of words collide is decided on their INK (TMPL-8).
 *
 * The audit used to compare element rectangles, and on the one design in the
 * tree that exercises the rule it was wrong: NYU Bold's section divider draws
 * its title box and its numeral box over one another by 6.1% of the slide —
 * as the source deck does — while the glyphs clear by 0.062 of the slide's
 * height, about a third of the title's own type size.
 *
 * ## Both directions, because either alone is trivially satisfiable
 *
 * A rule that stops faulting the divider by no longer reporting overlaps
 * would pass the first case below perfectly. So the second case takes the
 * same slide and moves the numeral up until the glyphs genuinely do collide,
 * and requires the fault back. Nothing else about the layout changes between
 * them: one number, in one direction, and the answer flips.
 *
 * ## The control is not ours, and what the two instruments do and do not agree on
 *
 * The raised-numeral fixture is a9's, built in a browser against the rendered
 * app and measured with `measureText`. The geometry underneath this rule was
 * checked against it before the rule was written, and agrees closely:
 *
 *   title ink bottom    predicted 0.4100   browser 0.4117
 *   numeral ink top     predicted 0.4813   browser 0.4736
 *   raised-0.15 control predicted 3.95%    browser 4.038%
 *
 * Two instruments sharing no code — one reading a live DOM, one reading
 * `glyf` tables — is worth more than either alone.
 *
 * **But those are predictions for the strings actually on the slide, and the
 * rule does not measure those.** It bounds what the SLOTS PERMIT, so it
 * reports a larger figure for the same fixture than the browser did on
 * "01". The agreement above validates the geometry; it does not validate the
 * number this file asserts, and reading it as though it did would be
 * comparing two quantities because they came out close.
 *
 * ## What this does NOT prove
 *
 * That the shipped divider is clear for every string. It is not, and the
 * limit is stated in `shared/types/text-ink`: a `Q` in the title under the
 * dot of an `i` in the numeral reaches into the gap. The shipped layout buys
 * that back with an authored nudge (`scripts/build-nyu-bold.ts`), so the
 * first case below passes on geometry rather than on the assumption.
 */
import { describe, expect, it } from 'vitest'
import { auditTemplate } from './audit'
import { loadBuiltinTemplates } from './builtin'
import type { Layout, Template } from '@slide-machine/shared'

const nyuBold = (): Template => {
  const found = loadBuiltinTemplates().find(t => t.id === 'nyu-bold')
  if (!found) throw new Error('nyu-bold is not among the built-in designs')
  return found
}

/**
 * The numeral box, as it was shipped when these numbers were measured.
 *
 * The design no longer carries it: a section number has to change from one
 * divider to the next and the app has no notion of a section's index, so the
 * slot was removed rather than filled by hand or guessed at. See
 * `docs/DECISIONS.md`.
 *
 * It stays here because the RULE is what this file tests, and the rule is
 * unchanged. These figures were measured against the real design and the
 * geometry is reproduced verbatim; what is gone is a design that ships it,
 * not the case it made. Reading a fault here as a statement about a shipped
 * template would now be wrong, which is why this says so.
 */
const NUMERAL = {
  x: 0.47556123496281716,
  y: 0.3429566676387674,
  w: 0.506496062992126,
  h: 0.6570433323612326,
  fontSize: 34.72,
  fontWeight: 700,
  fontFamily: 'montserrat',
  color: '#8900e1',
  lineHeight: 1.196,
  align: 'start',
  vAlign: 'start',
} as const

/** Just the divider, as its own one-layout template — so a fault from any
 * other layout cannot be mistaken for this one. The numeral is put back
 * because the design no longer ships one; everything else is as shipped. */
const dividerOnly = (change?: (layout: Layout) => void): Template => {
  const template = JSON.parse(JSON.stringify(nyuBold())) as Template
  const divider = template.layouts.find(l => l.type === 'section')
  if (!divider) throw new Error('nyu-bold has no section layout')
  divider.elementPositions = {
    ...(divider.elementPositions ?? {}),
    number: { ...NUMERAL },
  } as Layout['elementPositions']
  change?.(divider)
  return { ...template, layouts: [divider] }
}

const overlapFaults = (template: Template): string[] =>
  auditTemplate(template)
    .faults.filter(fault => fault.rule === 'overlap')
    .map(fault => fault.message)

describe('what counts as two boxes of words colliding', () => {
  /**
   * The premise. Every case here is about two particular boxes, and a divider
   * that lost one of them would report no overlap for the wrong reason —
   * which reads exactly like the right one.
   */
  it('has both boxes, overlapping as rectangles', () => {
    const divider = dividerOnly().layouts[0]!
    const title = divider.elementPositions?.title
    const number = divider.elementPositions?.number
    expect(title, 'the divider has no title box').toBeDefined()
    expect(
      number,
      'the numeral box is missing from the fixture — it is supplied by ' +
        'dividerOnly() and no longer comes from the shipped design',
    ).toBeDefined()

    // The rectangles really do overlap. If they ever stop, this file is
    // measuring nothing and the case below would pass over it.
    const shared =
      (Math.min(title!.x + title!.w, number!.x + number!.w) -
        Math.max(title!.x, number!.x)) *
      (Math.min(title!.y + title!.h, number!.y + number!.h) -
        Math.max(title!.y, number!.y))
    expect(shared).toBeGreaterThan(0.05)
  })

  it('does not fault a design whose rectangles overlap but whose ink does not', () => {
    expect(
      overlapFaults(dividerOnly()),
      `NYU Bold's divider was reported as a collision. Its two rectangles do ` +
        `overlap, by 6.1% of the slide, exactly as the source deck draws ` +
        `them — and its glyphs clear by about a third of the title's type ` +
        `size. A rule that faults this teaches a reader to skip the section`,
    ).toEqual([])
  })

  it('still faults a design whose ink really does collide', () => {
    // a9's control: the same numeral, moved up 0.15 of the slide from where
    // NYU draws it, which is the smallest change that puts glyph over glyph.
    // Placed at NYU's own y less 0.15, not at the shipped y less 0.15 — the
    // shipped box carries an authored nudge, and raising from there would
    // measure a different slide than a9 did.
    const faults = overlapFaults(
      dividerOnly(layout => {
        layout.elementPositions!.number!.y = 0.3229566676387674 - 0.15
      }),
    )
    expect(
      faults,
      `the numeral was moved up until its glyphs sit on the title's and ` +
        `nothing was reported. A rule that never fires would pass the case ` +
        `above for the wrong reason`,
    ).toHaveLength(1)
    // Several per cent of the slide, not a sliver. Asserted as a floor
    // rather than a figure: the exact number is this model's, and pinning it
    // would make the case a test of the implementation instead of of the
    // collision. The browser saw 4.038% here for the strings on the slide;
    // this bounds every string the slots allow, so it reads higher.
    const percent = Number(/over (\d+\.\d)%/.exec(faults[0]!)?.[1])
    expect(percent).toBeGreaterThan(3)
  })

  /**
   * The fallback, which is the half a reader would never think to check.
   *
   * Ink is a property of a typeface and the app bundles two. A design set in
   * anything else must keep comparing rectangles — the conservative
   * direction, since it can fault a design that is fine but never pass one
   * that is not. Silently treating an unmeasurable face as clear would turn
   * this rule off for most templates while it went on reporting green.
   */
  it('falls back to the rectangle for a face it has no metrics for', () => {
    const faults = overlapFaults(
      dividerOnly(layout => {
        for (const box of Object.values(layout.elementPositions ?? {}))
          box.fontFamily = 'geometric'
      }),
    )
    expect(
      faults,
      `a design in an unbundled face reported no overlap. We cannot know ` +
        `where its ink lands, so the rectangles are all there is to compare ` +
        `— and these overlap by 6.1% of the slide`,
    ).toHaveLength(1)
  })
})
