/**
 * Whether the deck's own words fit the budgets we derived from its own boxes
 * (TMPL-8).
 *
 * This is the plainest statement there is that an import's arithmetic is
 * right, and it needs no theory to read. Every budget in a derived template
 * is an estimate of how much a box holds — characters across times lines
 * down, from `text-metrics.ts`. The deck those boxes were measured from is
 * sitting right there, already holding text in them, at a size its designer
 * chose and presumably looked at. So the estimate has a known-good answer to
 * be checked against: whatever NYU actually put on the slide fitted, because
 * it is on the slide.
 *
 * If our derived `maxChars` is smaller than the text the box already holds,
 * the estimate is wrong. Not "possibly too tight" — wrong, demonstrably, with
 * the counterexample supplied by the source. And it matters beyond tidiness:
 * the generator is told those numbers and the server trims to them, so a
 * budget under the truth means every slide the app writes on this design is
 * shorter than the design was built for, for the life of the template.
 *
 * ## The trap this test is built to avoid
 *
 * It must compare against the budget the importer DERIVES, not against a
 * number copied into this file. A copied number stops being a check the
 * moment the derivation changes: it goes green against whatever the importer
 * last produced, which is the same thing as not testing it. So the template
 * is built here, in this file, by running the import — and both sides of
 * every comparison come out of that one run.
 *
 * That is also why nothing below asserts a particular character count. The
 * derived numbers are expected to move. The property is the relation between
 * the two, and it holds whatever they move to.
 *
 * ## Read the direction of the failure
 *
 * A budget SMALLER than the source text is the fault. A budget larger is not
 * one — a box can hold more than its designer chose to put in it, and a deck
 * whose author wrote short titles says nothing about the box's capacity. So
 * this is a one-sided check on purpose, and it stays one.
 *
 * ## What passing here does NOT prove
 *
 * Worth stating, because this test is easy to over-read. It bounds the
 * estimate from one side; it does not measure its accuracy. An estimate that
 * is two per cent off passes it comfortably, and so would one that is thirty
 * per cent too generous — nothing here would notice either. What it proves is
 * that the estimate is not badly wrong in the direction that costs users
 * content, which is the direction that was actually wrong.
 *
 * The precision of the constant behind it is a separate question, answered by
 * measuring the source deck's own spacing rather than by any assertion in
 * this file. That belongs in a docstring like this one rather than in an
 * `expect`, which would otherwise claim a precision it cannot check.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { toSourcePresentation } from './read-slides'
import { importSourcePresentation } from './import-presentation'
import type { ImportResult } from './import-presentation'

// No pictures are fetched: the import runs without an assetPrefix, so nothing
// here touches the network or storage.
vi.mock('../storage', () => ({
  getStorage: () => ({
    put: vi.fn(),
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  }),
}))

const FIXTURE = new URL(
  '../../test/fixtures/presentation-nyu-bold.json',
  import.meta.url,
)

let result: ImportResult

beforeAll(async () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    unknown
  >
  // `keepEverySlide` is what every import route actually sends
  // (`KEEP_EVERY_SLIDE_BY_DEFAULT`), so this is the path a real import takes
  // and therefore the one worth measuring.
  result = await importSourcePresentation(toSourcePresentation(raw), {
    keepEverySlide: true,
  })
})

/** Every text a slide put in a text box, with where it landed. */
interface Placed {
  slideId: string
  layoutType: string
  slot: string
  text: string
}

/** The slot spec the import derived for a given layout and slot name. */
const specFor = (layoutType: string, slot: string) =>
  result.template.layouts
    .find(layout => layout.type === layoutType)
    ?.slots?.find(candidate => candidate.name === slot)

/** Prose boxes only. A list is bounded differently — see below. */
const placedTexts = (): Placed[] =>
  result.slides.flatMap(slide =>
    Object.entries(slide.slots).flatMap(([slot, value]) =>
      value.kind === 'text' || value.kind === 'preformatted'
        ? [
            {
              slideId: slide.slideId,
              layoutType: slide.layoutType,
              slot,
              text: value.value,
            },
          ]
        : [],
    ),
  )

/**
 * How many lines a list's points take at a given characters-per-line.
 *
 * The unit a list box is actually bounded in. `capacityOf` gives a bullets
 * box `maxChars = perLine` and `maxItems = lines`, which are the width and
 * the height of the same rectangle — so what has to fit is the total number
 * of LINES the points wrap to, not the number of points and not the length
 * of any one of them.
 */
const linesUsed = (items: string[], perLine: number): number =>
  items.reduce((total, item) => total + Math.ceil(item.length / perLine), 0)

describe('a derived design against the deck it was derived from', () => {
  /**
   * Guards every case below, all of which iterate the import's output.
   *
   * An import that produced no slides, or slots with no budgets, would run no
   * comparisons and report exactly what a clean run reports. The premise has
   * to fail as itself.
   */
  it('imported a deck with text in it', () => {
    expect(result.slides.length).toBeGreaterThan(0)
    expect(result.template.layouts.length).toBeGreaterThan(0)
    const placed = placedTexts()
    expect(placed.length, 'no text was placed on any slide').toBeGreaterThan(0)
    // And the budgets exist to be checked against — a template that declared
    // none would pass every comparison below by having nothing to compare.
    const budgeted = placed.filter(
      p => typeof specFor(p.layoutType, p.slot)?.maxChars === 'number',
    )
    expect(
      budgeted.length,
      'no placed text landed in a slot carrying a maxChars, so the ' +
        'comparison below would be vacuous',
    ).toBeGreaterThan(0)
  })

  it('never budgets a prose box for less than the deck already put in it', () => {
    const over: string[] = []
    for (const placed of placedTexts()) {
      const budget = specFor(placed.layoutType, placed.slot)?.maxChars
      // A slot with no stated budget makes no claim, so there is nothing to
      // be wrong about.
      if (typeof budget !== 'number') continue
      if (placed.text.length > budget) {
        over.push(
          `${placed.layoutType}.${placed.slot} (slide ${placed.slideId}) ` +
            `is budgeted for ${budget} characters but the source deck ` +
            `already holds ${placed.text.length}: ` +
            `${JSON.stringify(placed.text.slice(0, 60))}`,
        )
      }
    }
    expect(
      over,
      `The design's own source content does not fit the budgets derived ` +
        `from its own boxes. Every one of these is a box the deck shows ` +
        `working at a size we estimated it could not hold, so the estimate ` +
        `is wrong — not the deck.\n\n${over.join('\n')}`,
    ).toEqual([])
  })

  /**
   * Bounded on the whole box rather than on any one point, and the
   * distinction is the substance of the case rather than a detail of it.
   *
   * `capacityOf` gives a bullets box `maxChars = perLine` and
   * `maxItems = lines`. Those are two measurements of one rectangle, and they
   * cannot both hold as separate promises for a design whose points wrap: a
   * box of eleven lines does not hold eleven points of forty-five characters
   * AND stay one line per point once any point runs long.
   *
   * So what is asserted is the property the box actually has — the points
   * wrap to no more lines than the box has. Asserting per-point instead would
   * report NYU's own list box as over its budget, and that would be reading a
   * one-line-per-point EDITORIAL instruction as a claim about capacity. The
   * deck shows a 240-character point rendering in that box; the box holds it.
   *
   * The per-point model is a real limitation of the importer and is recorded
   * as one. It is not this test's business to decide it, and deliberately not
   * loosened here to produce a green: the measurement changed to the property
   * the design claims, which is a different thing from relaxing a threshold.
   */
  it('never budgets a list box for fewer lines than the deck already fills', () => {
    const over: string[] = []
    for (const slide of result.slides) {
      for (const [slot, value] of Object.entries(slide.slots)) {
        if (value.kind !== 'bullets') continue
        const spec = specFor(slide.layoutType, slot)
        const perLine = spec?.maxChars
        const lines = spec?.maxItems
        if (typeof perLine !== 'number' || typeof lines !== 'number') continue
        const used = linesUsed(value.items, perLine)
        if (used > lines) {
          over.push(
            `${slide.layoutType}.${slot} (slide ${slide.slideId}) is ` +
              `budgeted for ${lines} lines of ${perLine} characters but the ` +
              `source deck's ${value.items.length} point(s) wrap to ${used}`,
          )
        }
      }
    }
    expect(over, over.join('\n')).toEqual([])
  })
})

/**
 * The cases above, shown to be capable of failing.
 *
 * Built rather than borrowed, and that is the point of it. These checks fired
 * on the real deck while the importer's leading was wrong; it is right now, so
 * all three pass and the real deck no longer demonstrates anything about
 * whether they still work. A control that depends on a bug being present stops
 * being a control the moment the bug is fixed — which is exactly when it is
 * needed, because from then on a green is the only thing anyone ever sees.
 *
 * So the predicates are exercised on constructed values, at the boundary and
 * on both sides of it. Nothing here reads the fixture.
 */
describe('the budget predicates themselves', () => {
  it('counts a point that runs one character long as a whole extra line', () => {
    // The reason this is lines and not total characters. Both lists hold
    // eleven points and about the same number of characters; only the second
    // fits a box of eleven lines.
    expect(
      linesUsed(
        Array.from({ length: 11 }, () => 'x'.repeat(45)),
        45,
      ),
    ).toBe(11)
    expect(
      linesUsed(
        Array.from({ length: 11 }, () => 'x'.repeat(46)),
        45,
      ),
    ).toBe(22)
    // A total-character bound would have accepted the second: 11 × 46 = 506
    // against a nominal 11 × 45 = 495 is over by 2%, while the box it has to
    // fit in is over by a factor of two.
  })

  it('detects a prose box given more than it states', () => {
    const over = (text: string, budget: number) => text.length > budget
    expect(over('x'.repeat(27), 26), 'one character over').toBe(true)
    expect(over('x'.repeat(26), 26), 'exactly at the budget').toBe(false)
    expect(over('x'.repeat(25), 26), 'one character under').toBe(false)
    // The historical case: a 13-character title box holding NYU's own
    // 21-character "TITLE OF PRESENTATION".
    expect(over('TITLE OF PRESENTATION', 13)).toBe(true)
  })

  it('detects a list box whose points wrap past its lines', () => {
    // The historical case: one 240-character paragraph in a box budgeted at
    // 45 characters per line. Six lines used, and it fits eleven — so this
    // is NOT a fault, which is the whole reason the model changed from
    // per-point to per-line.
    expect(linesUsed(['x'.repeat(240)], 45)).toBe(6)
    expect(linesUsed(['x'.repeat(240)], 45) > 11).toBe(false)
    // But the same box given twice that genuinely overflows it.
    expect(linesUsed(['x'.repeat(240), 'x'.repeat(240)], 45) > 11).toBe(true)
  })
})
