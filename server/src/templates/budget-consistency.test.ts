/**
 * Whether a shipped design's stated budgets still agree with its own boxes
 * (TMPL-8).
 *
 * A derived template's `maxChars` is not a preference anybody typed — it is a
 * calculation over the box it belongs to: how many characters fit across it,
 * times how many lines fit down it, from that box's rectangle, its type size
 * and its leading. So the file contains both the answer and everything needed
 * to check it, and this recomputes the answer and compares.
 *
 * ## The failure it exists to catch
 *
 * A template file is a BUILD OUTPUT. The importer that produced it goes on
 * being changed afterwards, and nothing in the repository re-derives a file
 * that was committed months ago. So the ordinary way for this to go wrong is
 * not a bad calculation — it is a correct calculation that nobody re-ran.
 *
 * That failure is invisible to every other check we have. The template still
 * loads, still validates, still fits the descriptor cap, still audits clean,
 * still renders. Every suite stays green while the numbers reaching the
 * generator were derived from arithmetic the code no longer performs, and
 * they go on doing so for the life of the template — `limitsFor` reads the
 * STORED `maxChars` first (`spec.maxChars ?? style?.maxChars ?? …`) and never
 * recomputes, so a stale number is not a stale cache, it is the live value.
 *
 * ## Why it does not compare against an import run
 *
 * The obvious version of this check re-imports the source deck and diffs. It
 * would be wrong. A shipped built-in legitimately differs from a bare import:
 * its layouts are named semantically rather than `two-column-3`, it carries
 * conventional layouts the source deck had no slide for, and its picture URLs
 * have been rewritten to the paths the app serves them from. A diff would
 * report all of that as failure, and would need a fixture deck on hand to
 * report anything at all.
 *
 * Asking instead whether the file agrees with ITSELF needs no import, no
 * fixture and no network, and survives every rename and reorder.
 *
 * ## What it reaches, and what it does not
 *
 * Only layouts that state their geometry as rectangles. A tree-stated layout
 * describes an arrangement rather than a list of boxes, and its budgets were
 * derived from source rectangles the file no longer carries — so there is
 * nothing in it to recompute against. That is a real gap: today it means the
 * per-box budgets of a tree-stated design go unverified here, and the case
 * says which designs those are rather than passing quietly over them.
 *
 * ## What passing does NOT prove
 *
 * That the budgets follow from the geometry and leading recorded IN THE FILE.
 * Not that the leading recorded in the file is the leading the source deck
 * was set at — a design uniformly wrong about its own leading is perfectly
 * self-consistent and passes here. Whether a leading is faithful is a
 * measurement of the source, and it belongs in prose like this rather than in
 * an assertion that cannot check it.
 */
import { describe, expect, it } from 'vitest'
import { capacityOf } from '../import/text-metrics'
import { mapFont } from '../import/font-map'
import { listBuiltinTemplates } from './builtin'

const templates = listBuiltinTemplates()

/**
 * The boxes a layout states as rectangles, which is the only form this check
 * can honestly read.
 *
 * A design states its geometry one of two ways, and the difference decides
 * whether recomputing a budget is possible at all.
 *
 * `elementPositions` is a list of rectangles. A budget derived from one of
 * those was derived from exactly the numbers still sitting in the file, so
 * recomputing it is a real check.
 *
 * A `tree` is not that. It describes an arrangement the renderer resolves,
 * and several of its boxes size themselves to what they are given — so the
 * rectangle a tree yields depends on the content passed in, and there is no
 * content here. Worse, a tree is a LATER re-expression of a design whose
 * budgets were derived from the source deck's rectangles, which the file no
 * longer contains. So the geometry a budget came from is simply not in a
 * tree-stated layout, and no amount of resolving recovers it.
 *
 * This was learned the expensive way rather than reasoned out. Resolving the
 * tree with empty content and comparing produced thirty-six disagreements on
 * one design, in both directions at once, with body boxes reported at four
 * hundredths of the slide's height — flow boxes collapsed for want of
 * anything to hold. Every one of those would have been a false finding
 * against a design that is fine, and the give-away was the direction: a
 * genuinely stale file is wrong one way, because one constant moved.
 *
 * So tree-stated layouts are out of scope and said to be, rather than
 * measured badly. What that costs is stated in the case itself.
 */
const rectanglesOf = (
  layout: (typeof templates)[number]['layouts'][number],
): Map<string, { rect: Rect; style: Record<string, unknown> }> =>
  new Map(
    Object.entries(layout.elementPositions ?? {}).map(([name, box]) => [
      name,
      { rect: box as Rect, style: box as unknown as Record<string, unknown> },
    ]),
  )

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

describe('a shipped design against its own geometry', () => {
  /**
   * Guards every case below, which are generated from the loaded set.
   *
   * A design that failed to load contributes no case, and a run of fewer
   * cases reports exactly what a clean run reports.
   */
  it('is a set worth checking at all', () => {
    expect(templates.length).toBeGreaterThan(0)
    for (const template of templates)
      expect(
        template.layouts.length,
        `${template.id} has no layouts`,
      ).toBeGreaterThan(0)
  })

  /*
   * Coverage, stated in the title rather than left to be inferred.
   *
   * The case above can only reach budgets on stated rectangles, so for a
   * design that states none it passes having checked nothing — which is the
   * silent-vacuous result this suite otherwise exists to prevent, and it
   * would be dishonest to leave it looking like a clean bill of health.
   *
   * So every design also reports its accounting, in a test NAME a reader
   * cannot skim past: how many per-box budgets it declares, and how many of
   * them this check can actually recompute. A design whose numbers say
   * "0 of 36" is telling you plainly that its green above means nothing.
   *
   * The assertion is that the accounting adds up — every declared budget is
   * either reachable or knowably out of reach, and none has gone missing
   * between the two.
   */
  for (const template of templates) {
    const declared = template.layouts.flatMap(layout =>
      (layout.slots ?? []).filter(
        slot =>
          (slot.kind === 'text' || slot.kind === 'bullets') &&
          (slot.maxChars !== undefined || slot.maxItems !== undefined),
      ),
    ).length
    const budgeted = (
      layout: (typeof templates)[number]['layouts'][number],
    ): number =>
      (layout.slots ?? []).filter(
        slot =>
          (slot.kind === 'text' || slot.kind === 'bullets') &&
          (slot.maxChars !== undefined || slot.maxItems !== undefined),
      ).length
    const stated = (
      layout: (typeof templates)[number]['layouts'][number],
    ): boolean => Object.keys(layout.elementPositions ?? {}).length > 0
    const reachable = template.layouts
      .filter(stated)
      .reduce((n, layout) => n + budgeted(layout), 0)
    const unreachable = template.layouts
      .filter(layout => !stated(layout))
      .reduce((n, layout) => n + budgeted(layout), 0)
    it(`${template.id}: ${reachable} of ${declared} per-box budgets are recomputable here`, () => {
      // The two partitions are counted independently and must between them
      // account for every declared budget. If they do not, a budget has
      // fallen through a gap in the partitioning itself and is being
      // reported as neither checked nor knowably unchecked — which is the
      // one outcome this accounting exists to make impossible.
      expect(
        reachable + unreachable,
        `${template.id} declares ${declared} per-box budgets but the ` +
          `reachable (${reachable}) and unreachable (${unreachable}) counts ` +
          `sum to ${reachable + unreachable}`,
      ).toBe(declared)
    })
  }

  for (const template of templates)
    it(`${template.id} states budgets its own boxes support`, () => {
      const wrong: string[] = []
      let checked = 0

      for (const layout of template.layouts) {
        const boxes = rectanglesOf(layout)
        for (const slot of layout.slots ?? []) {
          if (slot.kind !== 'text' && slot.kind !== 'bullets') continue
          // A box that states no budget makes no claim to be wrong about.
          if (slot.maxChars === undefined && slot.maxItems === undefined)
            continue
          const found = boxes.get(slot.name)
          const style = found?.style ?? {}
          const fontSize = style.fontSize as number | undefined
          // Nothing to recompute from: a box with no rectangle or no type
          // size is a different fault, and the audit is where it belongs.
          if (!found || typeof fontSize !== 'number') continue

          const expected = capacityOf(
            { ...slot, box: found.rect, fontSize } as Parameters<
              typeof capacityOf
            >[0],
            {
              caps: style.caps as boolean | undefined,
              fontFamily: mapFont(style.fontFamily as string | undefined),
              lineHeight: style.lineHeight as number | undefined,
            },
          )
          checked++

          const where = `${template.id} ${layout.type}.${slot.name}`
          if (
            expected.maxChars !== undefined &&
            slot.maxChars !== expected.maxChars
          )
            wrong.push(
              `${where} states maxChars ${slot.maxChars} but its box ` +
                `(${found.rect.w.toFixed(3)}x${found.rect.h.toFixed(3)} at ` +
                `${fontSize}cqi, leading ${String(style.lineHeight)}) ` +
                `supports ${expected.maxChars}`,
            )
          if (
            expected.maxItems !== undefined &&
            slot.maxItems !== expected.maxItems
          )
            wrong.push(
              `${where} states maxItems ${slot.maxItems} but its box ` +
                `supports ${expected.maxItems}`,
            )
        }
      }

      /*
       * The premise, stated against what this design actually claims — and
       * against what this check can actually reach.
       *
       * Three cases have to be told apart, because two of them look like a
       * pass from outside. A design stating no per-box budgets has nothing to
       * be wrong about. A design whose budgets all sit in tree-stated layouts
       * cannot be recomputed at all, and saying so is the honest result. Only
       * a design with budgets on stated RECTANGLES that yielded nothing is a
       * hole wearing a pass, and that one fails.
       */
      const inRectangles = template.layouts
        .filter(layout => Object.keys(layout.elementPositions ?? {}).length)
        .flatMap(layout =>
          (layout.slots ?? []).filter(
            slot =>
              (slot.kind === 'text' || slot.kind === 'bullets') &&
              (slot.maxChars !== undefined || slot.maxItems !== undefined),
          ),
        ).length
      if (inRectangles > 0)
        expect(
          checked,
          `${template.id} states ${inRectangles} per-box budget(s) on ` +
            `stated rectangles but none could be recomputed — every one of ` +
            `them is unverified, which is a hole in this check rather than ` +
            `a clean result`,
        ).toBeGreaterThan(0)

      expect(
        wrong,
        `${template.id} states budgets its own geometry does not support. ` +
          `A template file is a build output: the usual cause is not a bad ` +
          `calculation but a correct one nobody re-ran after the importer ` +
          `changed. Regenerate the template.\n\n${wrong.join('\n')}`,
      ).toEqual([])
    })
})
