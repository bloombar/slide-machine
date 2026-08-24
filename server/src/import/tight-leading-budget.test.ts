/**
 * What a box led tighter than its face's natural line box is budgeted to hold
 * (TMPL-8).
 *
 * The renderer grants such a box an overrun of `SLACK_EM` before it shrinks
 * anything, because a face set below `TIGHT_LEADING` hangs its ink outside
 * the line box at every type size. `text-metrics` now grants the same term.
 * Two models of one physical quantity, made to agree.
 *
 * This exists because the disagreement was invisible. A budget STRICTER than
 * the renderer produces no symptom: the box draws correctly, and the only
 * trace is content trimmed to a bound nothing on screen justifies. Nothing
 * fails, nothing looks wrong, and the design is quietly smaller than the deck
 * it came from. So the agreement needs a check, or the next change to either
 * side reopens it silently.
 *
 * ## The numbers here came from a browser, not from this model
 *
 * The two anchored cases are the only kind of expectation worth having about
 * a budget: what the app was MEASURED drawing. Both were run against the
 * built app in Chromium with Montserrat loaded, filled with real text, with
 * a control at a deliberately impossible height to show the measurement could
 * report a failure:
 *
 *   section.title  27 chars, two lines, `--fit-scale` 1.00, 197/199px
 *                  — a 2px overrun against a 23px allowance. Control at
 *                  h 0.25 shrank to 0.80 and overran by 22px.
 *   closing.title  25 chars, `--fit-scale` 1.00, 113/113px — no overrun at
 *                  all. Control at 45 chars shrank to 0.775.
 *
 * A budget below those is refusing characters the app draws. Asserting the
 * exact figure rather than a lower bound is deliberate: this is the number
 * the generator writes into the shipped design, and a change to it is a
 * change to what every author of that deck may type.
 *
 * ## Why the captured decks are not enough on their own
 *
 * Measured rather than assumed: across the two decks in `test/fixtures`,
 * `presentation-nyu-bold.json` has 7 boxes led under `TIGHT_LEADING` out of
 * 26 text boxes, and `presentation-urban-hydrology.json` has NONE out of 11.
 * So "over both captured decks" would be a case over one deck wearing a
 * plural — the same weakness as measuring this change against five built-ins
 * when three of them state no budgets at all.
 *
 * The last case therefore states the rule itself over synthetic geometry, so
 * that a future change to the allowance fails against the RULE rather than
 * against one deck's numbers.
 */
import { describe, expect, it } from 'vitest'
import { SLACK_EM, TIGHT_LEADING } from '@slide-machine/shared'
import { capacityOf } from './text-metrics'
import { mapFont } from './font-map'

const MONTSERRAT = mapFont('Montserrat')

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The budget this model gives a prose box of that geometry and type. */
const budget = (
  box: Box,
  fontSize: number,
  lineHeight: number,
  caps = false,
): number =>
  capacityOf(
    { name: 'title', kind: 'text', box, fontSize } as Parameters<
      typeof capacityOf
    >[0],
    { caps, fontFamily: MONTSERRAT, lineHeight },
  ).maxChars ?? 0

describe('a box led tighter than the face’s natural line box', () => {
  /**
   * The boxes whose budgets were checked against a real render.
   *
   * Both are NYU Bold's own, at the geometry the shipped design states.
   */
  const ANCHORED: {
    where: string
    box: Box
    fontSize: number
    lineHeight: number
    drawn: number
  }[] = [
    {
      where: 'section.title',
      box: { x: 0.0347, y: 0.0889, w: 0.9318, h: 0.3581 },
      fontSize: 9.44,
      lineHeight: 0.957,
      drawn: 27,
    },
    {
      where: 'closing.title',
      box: { x: 0.2644, y: 0.2572, w: 0.4712, h: 0.2059 },
      fontSize: 5,
      lineHeight: 1.017,
      drawn: 25,
    },
  ]

  for (const { where, box, fontSize, lineHeight, drawn } of ANCHORED)
    it(`${where} is budgeted for the ${drawn} characters the browser draws`, () => {
      expect(
        lineHeight,
        `${where} is not a tight-leading box, so it is the wrong anchor`,
      ).toBeLessThan(TIGHT_LEADING)
      expect(
        budget(box, fontSize, lineHeight, true),
        `${where} was measured in a browser drawing ${drawn} characters at ` +
          `full size. A budget other than ${drawn} means this model and the ` +
          `renderer disagree about the same box — and a budget BELOW it is ` +
          `invisible in use, because the box draws correctly and only the ` +
          `content is quietly trimmed`,
      ).toBe(drawn)
    })

  /**
   * The cliff that started this, now closed.
   *
   * `content.title` and `closing.title` are the same box at the same type and
   * leading, four per cent apart in height. They were budgeted 25 and 14 —
   * a 79% swing, because one crossed a line boundary and the other did not.
   * A four per cent difference in geometry cannot honestly produce that.
   */
  it('two boxes four per cent apart in height are not budgeted 79% apart', () => {
    const content = budget(
      { x: 0.0341, y: 0.0829, w: 0.4712, h: 0.2145 },
      5,
      1.017,
      true,
    )
    const closing = budget(
      { x: 0.2644, y: 0.2572, w: 0.4712, h: 0.2059 },
      5,
      1.017,
      true,
    )
    const gap = Math.abs(content - closing) / Math.max(content, closing)
    expect(
      gap,
      `content.title is budgeted ${content} and closing.title ${closing}, ` +
        `from boxes 4% apart in height. A jump like that is a line boundary ` +
        `showing through, not a measurement of the two boxes`,
    ).toBeLessThan(0.1)
  })

  /**
   * The rule itself, over geometry no deck supplied.
   *
   * Stated as a comparison between two leadings a thousandth apart, one
   * either side of `TIGHT_LEADING`. At that distance the line arithmetic is
   * effectively identical, so any difference in budget is the ALLOWANCE and
   * nothing else — which is what has to be pinned, since it is the term that
   * was missing.
   *
   * Two claims, and the second is what stops the first being vacuous: the
   * tighter box is never budgeted for less, and for some heights it is
   * budgeted for more. A model that had dropped the allowance again would
   * satisfy "never less" perfectly.
   */
  it('gets more room than the same box a thousandth looser, and never less', () => {
    let greater = 0
    let smaller = 0
    for (let h = 0.1; h < 0.6; h += 0.002) {
      const box = { x: 0, y: 0, w: 0.5, h }
      const tight = budget(box, 5, TIGHT_LEADING - 0.001)
      const loose = budget(box, 5, TIGHT_LEADING)
      if (tight > loose) greater++
      if (tight < loose) smaller++
    }
    expect(
      smaller,
      `a box led under ${TIGHT_LEADING} was budgeted for LESS than the same ` +
        `box a thousandth looser, at ${smaller} heights. The allowance can ` +
        `only add room`,
    ).toBe(0)
    expect(
      greater,
      `a box led under ${TIGHT_LEADING} was never budgeted for more than the ` +
        `same box a thousandth looser. The ${SLACK_EM}em allowance the ` +
        `renderer grants is not reaching this model, so every budget it ` +
        `derives for a tight-led box is stricter than what the app draws`,
    ).toBeGreaterThan(0)
  })

  /**
   * How much room the allowance is worth, which is the part a new term could
   * change without any other case noticing.
   *
   * The three cases above would all stay green if someone added a second
   * allowance beside `SLACK_EM`, or scaled it: the anchored budgets happen to
   * land on the same line either way for a wide range of values, and the
   * direction rule only asks that tight boxes get MORE. So this measures the
   * size of the step rather than its existence.
   *
   * Measured as a distance, not read off the code: the smallest box height
   * that reaches a given budget, at each of two leadings a thousandth apart
   * either side of the threshold. The difference between those two heights
   * IS the allowance, converted to ems — and it must be `SLACK_EM` and
   * nothing else.
   */
  it(`is worth exactly ${SLACK_EM}em of box height and no more`, () => {
    const FONT = 5
    const STEP = 0.0002
    // A fraction of the page's HEIGHT, in ems of type measured in cqi —
    // percent of the page's WIDTH — at 16:9.
    const toEms = (h: number): number => (h * 56.25) / FONT

    const firstHeightReaching = (
      lineHeight: number,
      target: number,
    ): number => {
      for (let h = 0.1; h < 0.8; h += STEP)
        if (budget({ x: 0, y: 0, w: 0.5, h }, FONT, lineHeight) >= target)
          return h
      return Number.NaN
    }

    // A budget several lines up, so the threshold being measured is a real
    // line boundary rather than the one-line floor.
    const target = budget({ x: 0, y: 0, w: 0.5, h: 0.3 }, FONT, TIGHT_LEADING)
    expect(target, 'the target budget is at the floor').toBeGreaterThan(0)

    const loose = firstHeightReaching(TIGHT_LEADING, target)
    const tight = firstHeightReaching(TIGHT_LEADING - 0.001, target)
    expect(
      Number.isNaN(loose) || Number.isNaN(tight),
      'no height reached the target',
    ).toBe(false)

    expect(
      toEms(loose - tight),
      `a box led under ${TIGHT_LEADING} reached the same budget ` +
        `${toEms(loose - tight).toFixed(3)}em shorter than one led at it. ` +
        `That distance is the allowance, and it must be exactly ${SLACK_EM} ` +
        `— the renderer's own. A different number means this model and ` +
        `useFitText no longer grant the same room, which is the ` +
        `disagreement this file exists to prevent`,
    ).toBeCloseTo(SLACK_EM, 2)
  })
})
