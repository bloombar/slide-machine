/**
 * Which text boxes an import treats as ornament rather than as content
 * (TMPL-8).
 *
 * The importer refuses to make a slot out of a box too small to hold a word,
 * because such a box is a decorative initial or a slide number rather than
 * somewhere an author writes. The rule is sound and the design needs it. What
 * it measured was wrong: character CAPACITY, which is a box's size divided by
 * its type size — so a box is called ornament either because it is small OR
 * because its type is enormous, and those are opposite things.
 *
 * On NYU's own deck that erased the section divider's "01": a numeral set at
 * 250pt across half the page, which is the dominant graphic of the slide. It
 * measured two characters of capacity and went out with the slide numbers.
 *
 * ## Both directions, because either alone is trivially satisfiable
 *
 * A rule that keeps the numeral by keeping everything is not a fix — it
 * restores the boxes the guard exists to remove, and the harm those did is
 * recorded in `candidate.ts`: unusable boxes in the editor, overlapping the
 * real content, and an AI told a `body` slot holds one character. A rule that
 * keeps rejecting the numeral is not a fix either. So this pins a PAIR, and
 * the pair is what makes it a test rather than a preference.
 *
 * Both halves are the real thing. They are read out of the captured deck at
 * `test/fixtures/presentation-nyu-bold.json` rather than typed in here,
 * because invented numbers would be chosen to sit either side of whatever
 * threshold the fix lands on, and would then agree with it by construction.
 * These two are, measured, the ONLY boxes in that entire deck the rule drops:
 *
 *   - the numeral: 0.5065 x 0.6819 of the page at 34.72cqi — a third of the
 *     slide's area, capacity 2
 *   - the quote glyph: 0.0571 x 0.1399 at 5.83cqi — eight thousandths of the
 *     slide's area, capacity 1
 *
 * They are 43 times apart in area and sit on the same side of a capacity
 * count, which is the whole shape of the defect in two numbers.
 *
 * ## Dropped, not demoted, which is the part nobody would notice
 *
 * A box the rule rejects reaches neither `slots` nor `decoration`. It is
 * erased. Verified rather than read off the code: on the divider page,
 * `candidateOf` returns six elements' worth of page as two slots and three
 * decorations, and the numeral's rectangle appears in none of them.
 *
 * A missing slot is visible — an author looks for a box and it is not there.
 * A dropped ornament is invisible, because a design that never drew it looks
 * exactly like a design that lost it. So it gets its own case.
 *
 * ## The other half of the defect is NOT checked here, and cannot be
 *
 * An erased ornament is a real fault and it is not this file's. There is no
 * honest place to assert it: `LayoutDecoration` has no field for text, and
 * `build-template.ts` drops any decoration piece with neither a fill nor a
 * stored picture, so a box demoted to decoration is erased one stage later
 * anyway. A case asserting the demotion would go green while the ornament
 * stayed lost, which is worse than no case at all.
 *
 * So nothing here covers it. It is a model gap — a design cannot draw text as
 * decoration — and it is tracked as its own item rather than implied by a
 * green in this file.
 *
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toSourcePresentation } from './read-slides'
import { candidateOf } from './candidate'
import type {
  SourceBox,
  SourceElement,
  SourcePage,
} from './source-presentation'

const deck = toSourcePresentation(
  JSON.parse(
    readFileSync(
      new URL(
        '../../test/fixtures/presentation-nyu-bold.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>,
)

const pages = (): SourcePage[] => [...deck.slides, ...deck.layouts]

const textOf = (element: SourceElement): string =>
  (element.runs ?? []).map(run => run.text).join('')

/**
 * The one box in the deck whose text is exactly this, with the page it sits
 * on.
 *
 * Located by its content rather than by a page id, so the case reads as the
 * thing it is about. Uniqueness is asserted at the point of use: two matches
 * would mean this is measuring a different box than it says it is.
 */
const findBox = (
  text: string,
): { page: SourcePage; element: SourceElement }[] =>
  pages().flatMap(page =>
    page.elements
      .filter(element => textOf(element) === text)
      .map(element => ({ page, element })),
  )

const NUMERAL = '01'
const GLYPH = '“'

/** Two rectangles are the same box. Compared rather than identity-checked
 * because a slot carries a copy of its element's rectangle. */
const sameBox = (a: SourceBox, b: SourceBox): boolean =>
  Math.abs(a.x - b.x) < 1e-9 &&
  Math.abs(a.y - b.y) < 1e-9 &&
  Math.abs(a.w - b.w) < 1e-9 &&
  Math.abs(a.h - b.h) < 1e-9

describe('what an import calls ornament', () => {
  /**
   * The premise both cases rest on.
   *
   * Everything below finds a box in a captured deck and asks what became of
   * it. A box that stopped being there would make each of those cases pass
   * over nothing, and a suite reporting two greens about boxes it never found
   * is the exact failure this directory exists to avoid.
   */
  it('finds both boxes in the deck, at the sizes they were measured at', () => {
    const numeral = findBox(NUMERAL)
    const glyph = findBox(GLYPH)
    expect(numeral, `no box in the deck holds ${NUMERAL}`).toHaveLength(1)
    expect(glyph, 'no box in the deck holds the opening quote').toHaveLength(1)

    // The geometry this test was written about. Not a check of the importer —
    // a check that the fixture still contains the case, since every claim
    // below is about these particular numbers.
    const box = numeral[0]!.element.box
    expect(box.w).toBeCloseTo(0.5065, 3)
    expect(box.h).toBeCloseTo(0.6819, 3)
    expect(glyph[0]!.element.box.w).toBeCloseTo(0.0571, 3)
    expect(glyph[0]!.element.box.h).toBeCloseTo(0.1399, 3)

    // And that they really are the pair the defect is about: both hold too
    // few characters to pass a capacity count, while one is a third of the
    // slide and the other is a rounding error.
    const area = (b: SourceBox): number => b.w * b.h
    expect(area(box) / area(glyph[0]!.element.box)).toBeGreaterThan(20)
  })

  /**
   * The half that is currently wrong.
   *
   * A box a reader sees before anything else on the slide is content, and the
   * design cannot be reproduced without it.
   */
  it('keeps a box that is short because its type is huge', () => {
    const { page, element } = findBox(NUMERAL)[0]!
    const candidate = candidateOf(page)
    expect(
      candidate.slots.some(slot => sameBox(slot.box, element.box)),
      `the deck's section numeral (${element.box.w.toFixed(3)} x ` +
        `${element.box.h.toFixed(3)} of the page) did not become a slot. It ` +
        `is the dominant graphic of the divider slide; a design that loses ` +
        `it is not the design that was imported`,
    ).toBe(true)
  })

  /**
   * The half that must not change, and the reason the fix cannot simply be
   * "keep more".
   */
  it('still rejects a single glyph in a box nobody could write in', () => {
    const { page, element } = findBox(GLYPH)[0]!
    const candidate = candidateOf(page)
    expect(
      candidate.slots.some(slot => sameBox(slot.box, element.box)),
      `the deck's decorative quote mark (${element.box.w.toFixed(3)} x ` +
        `${element.box.h.toFixed(3)} of the page at ` +
        `${String(element.runs?.[0]?.fontSize)}cqi) became a slot. This is ` +
        `the box the ornament rule was written for: imported as content it ` +
        `is an unusable box in the editor and a body slot the AI is told ` +
        `holds one character`,
    ).toBe(false)
  })

  /**
   * The ordinary case, so a fix cannot be judged only by the two boxes it was
   * written against.
   *
   * Synthetic on purpose: it makes no claim about the deck, only that a plain
   * body box at a plain size is content, which no version of this rule should
   * ever have doubted.
   */
  it('leaves an ordinary text box alone', () => {
    const page: SourcePage = {
      id: 'ordinary',
      elements: [
        {
          id: 'body',
          kind: 'text',
          box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 },
          placeholder: 'BODY',
          runs: [{ text: 'Several words of ordinary prose.', fontSize: 3 }],
        },
      ],
    }
    expect(candidateOf(page).slots).toHaveLength(1)
  })
})
