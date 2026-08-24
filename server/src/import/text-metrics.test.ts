/**
 * How much a box holds, and how much room what it holds needs (TMPL-8).
 *
 * Both answers are arithmetic — there is no browser on the server — so the
 * numbers here are worked by hand from the same constants the module uses: a
 * character is half the type size wide, a line is one and a half times it
 * tall, a 16:9 slide is 56.25 `cqi` deep, every box reserves Google's text
 * inset of 2 `cqi` across and 1 down, and a line gives up 3 characters to
 * wrapping at word boundaries.
 *
 * Exact numbers rather than "about right", because two readers depend on this
 * agreeing with itself: the box that gets grown to fit its content, and the
 * budget a derived text role is given. Drift between them is the whole thing
 * this module exists to prevent.
 */
import { describe, it, expect } from 'vitest'
import type { CandidateSlot } from './candidate'
import { capacityOf, heightForText } from './text-metrics'

const slot = (over: Partial<CandidateSlot> = {}): CandidateSlot => ({
  name: 'body',
  kind: 'text',
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
  ...over,
})

describe('what a box can hold', () => {
  it('is what fits across, over as many lines as fit down', () => {
    // 80cqi wide less 2 of inset is 78, which is 39 characters at 4cqi type;
    // 16.875cqi deep less 1 of inset is 2 lines. The first line is broken and
    // gives up the 3-character wrapping allowance, the second ends the run
    // and gives up nothing: 36 + 39.
    expect(capacityOf(slot({ fontSize: 4 }))).toEqual({ maxChars: 75 })
  })

  it('counts a list’s characters per point rather than per box', () => {
    // A point is one line of the box, so its bound is one line's worth —
    // less the 1.4em the marker's indent takes, and with the 0.4em between
    // points paid out of the height. No wrapping allowance: a point that
    // takes one line is a point that never wraps.
    expect(capacityOf(slot({ kind: 'bullets', fontSize: 4 }))).toEqual({
      maxChars: 36,
      maxItems: 2,
    })
  })

  it('never bounds a box at nothing, however small it is drawn', () => {
    // A box too small for one character still has to accept one
    expect(
      capacityOf(slot({ box: { x: 0, y: 0, w: 0.01, h: 0.01 }, fontSize: 10 })),
    ).toEqual({ maxChars: 1 })
  })

  it('keeps the point count inside what the template schema accepts', () => {
    // 75 lines fit, but `maxItems` is bounded at 50 and an unclamped value
    // would fail `layoutSchema` and reject the whole imported layout
    expect(
      capacityOf(
        slot({
          kind: 'bullets',
          box: { x: 0, y: 0, w: 0.5, h: 1 },
          fontSize: 0.5,
        }),
      ),
    ).toEqual({ maxChars: 189, maxItems: 50 })
  })

  it('bounds a box in whole characters, which is what the schema takes', () => {
    // `maxChars` is an integer in the schema; a fractional one is rejected
    const { maxChars } = capacityOf(slot({ fontSize: 3 }))
    expect(Number.isInteger(maxChars)).toBe(true)
  })

  it('says nothing about a box that holds no text', () => {
    // A picture holds no words and a table's shape is its rows, not a count
    expect(capacityOf(slot({ kind: 'image', fontSize: 4 }))).toEqual({})
    expect(capacityOf(slot({ kind: 'table', fontSize: 4 }))).toEqual({})
  })

  it('says nothing about a box whose source never stated a type size', () => {
    // Without a size there is no arithmetic to do, and a guess would bound
    // the box at a number nothing measured
    expect(capacityOf(slot())).toEqual({})
  })
})

describe('the room a box’s own content needs', () => {
  it('is nothing when the deck never said what the box held', () => {
    expect(heightForText(slot({ fontSize: 4 }))).toBe(0)
    expect(heightForText(slot({ held: { lines: 3, longest: 20 } }))).toBe(0)
  })

  it('is the lines it holds, at the height a line takes', () => {
    // Two lines of 4cqi type, each 1.5 times its size, plus the inset the
    // box reserves, over a 56.25cqi slide
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 10 } })),
    ).toBeCloseTo(13 / 56.25, 10)
  })

  it('gives a line that runs past the box the rows it will wrap onto', () => {
    // 100 characters across a 36-character line is three rows, not one — a
    // box measured at one row hides the other two
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 100 } })),
    ).toBeCloseTo(37 / 56.25, 10)
  })

  it('asks for more room for the same text set larger', () => {
    const held = { lines: 3, longest: 60 }
    expect(heightForText(slot({ fontSize: 6, held }))).toBeGreaterThan(
      heightForText(slot({ fontSize: 3, held })),
    )
  })

  it('agrees with what the box was said to hold', () => {
    // The two readings of one estimate: a box given exactly its capacity
    // should need about exactly its own height, not several times it
    const s = slot({ fontSize: 4 })
    const { maxChars } = capacityOf(s)
    const needed = heightForText({
      ...s,
      held: { lines: 1, longest: maxChars! },
    })
    expect(needed).toBeLessThanOrEqual(s.box.h + 0.001)
  })
})

describe('the edges a real deck actually reaches', () => {
  it('treats a stated size of zero as no size at all', () => {
    // A source can state 0 rather than omit the field, and dividing by it
    // would bound the box at Infinity characters
    expect(capacityOf(slot({ fontSize: 0 }))).toEqual({})
    expect(
      heightForText(slot({ fontSize: 0, held: { lines: 3, longest: 20 } })),
    ).toBe(0)
  })

  it('still gives a box drawn with no width a character to hold', () => {
    // A zero-width shape is degenerate but importable, and a bound of zero
    // would tell the AI the box takes nothing
    expect(
      capacityOf(slot({ box: { x: 0, y: 0, w: 0, h: 0.3 }, fontSize: 4 })),
    ).toEqual({ maxChars: 2 })
  })

  it('gives an empty line the room of a line', () => {
    // A blank paragraph is still a paragraph; measuring it at no rows would
    // pull everything below it up over the text
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 2, longest: 0 } })),
    ).toBeCloseTo(13 / 56.25, 10)
  })

  it('asks for no room for a box measured as holding nothing', () => {
    expect(
      heightForText(slot({ fontSize: 4, held: { lines: 0, longest: 50 } })),
    ).toBe(0)
  })
})

/**
 * How the box is set, where the design says so.
 *
 * Both terms are fed from production — `capacityOf(slot, { caps })` in
 * `build-template`, and the role's own line height in `type-scale` — and
 * neither had a test that passed one. An estimate that quietly ignored its
 * settings would look exactly like one that honoured them, since the default
 * path is the one every other test here exercises.
 */
describe('the way a box is actually set', () => {
  it('fits fewer capitals across a line than mixed-case words', () => {
    // Capitals carry no narrow lowercase forms and no descender gaps, so a
    // title set in caps holds meaningfully less than the same box of prose.
    // Told otherwise, the overflow lands on the reader.
    //
    // The face is stated, and that is the point of the test rather than a
    // detail of it: Montserrat is one of the faces whose width was actually
    // measured, so these numbers answer to a measurement. Left unstated they
    // would resolve against the fallback for unmeasured faces, and the test
    // would assert an arithmetic identity about a constant nobody checked.
    //
    // Both numbers come from measurements of Montserrat itself — 0.522 for
    // prose and 0.637 for capitals — rather than from a ratio applied to the
    // first. An earlier version derived the caps figure by multiplying, and
    // the multiplier turned out to have been taken against Title Case rather
    // than prose, which understated it on every face.
    const set = { fontFamily: 'montserrat' }
    // 37 characters of prose across, 30 of capitals; two lines each, the
    // first of them broken.
    expect(capacityOf(slot({ fontSize: 4 }), set).maxChars).toBe(37 + 34)
    expect(
      capacityOf(slot({ fontSize: 4 }), { ...set, caps: true }).maxChars,
    ).toBe(30 + 27)
  })

  it('fits more lines down a box set with tight display leading', () => {
    // A display face at 0.95 puts half again as many lines in the same box as
    // the 1.5 fallback allows — which is how a title box was told it holds
    // one line when it holds two.
    //
    // FOUR, and the number has now been checked against a browser rather than
    // argued from the arithmetic. 15.875cqi of interior at 3.8cqi a line
    // takes four with room over; the reason this case said three is that a
    // face led below its natural box hangs ink outside that box at each end,
    // and the run was required to fit INCLUDING the overhang — four lines
    // plus 0.984cqi of ink is 16.18 in a box of 15.875.
    //
    // That was the estimate being stricter than the renderer, which is the
    // defect `SLACK_EM` exists to close: `useFitText` allows a box led under
    // `TIGHT_LEADING` a quarter em of overrun before it shrinks anything, and
    // 0.305cqi of overhang is well inside the 1.0cqi that allows.
    //
    // Measured, in the built app, in this exact box: 147 characters draw on
    // FOUR lines at `--fit-scale` 1.00, with `scrollHeight` equal to
    // `clientHeight` and no overflow at all. The control is 190 characters in
    // the same box, which shrinks to 0.95 — so the measurement can report a
    // box that does not fit, and "four lines fit" is a result rather than the
    // absence of one.
    //
    // What is left is 0.31cqi of worst-case ink outside the box, about 3px at
    // the size this renders — real for a descender, nil for a line without
    // one, and the same limit the ink model states for every tight-led box.
    expect(capacityOf(slot({ fontSize: 4 })).maxChars).toBe(75)
    expect(
      capacityOf(slot({ fontSize: 4 }), { lineHeight: 0.95 }).maxChars,
    ).toBe(39 + 36 + 36 + 36)
  })

  it('gives capitals the extra rows they wrap onto', () => {
    // 36 characters fit one line of prose and need two of capitals, so the
    // same words need twice the room
    const held = { lines: 2, longest: 36 }
    expect(heightForText(slot({ fontSize: 4, held }))).toBeCloseTo(
      13 / 56.25,
      10,
    )
    expect(
      heightForText(slot({ fontSize: 4, held }), { caps: true }),
    ).toBeCloseTo(25 / 56.25, 10)
  })

  it('asks for less room for the same lines set tighter', () => {
    // Less than the 13cqi the same two lines take at the 1.5 fallback, and
    // more than the 8.6 the leading alone would suggest: two lines at 0.95
    // are 7.6cqi of line box, plus 0.984 of ink hanging outside it, plus the
    // 1cqi inset Google keeps. A box given only the 8.6 clips its own
    // descenders, which is the defect the overhang term exists for.
    const held = { lines: 2, longest: 10 }
    expect(
      heightForText(slot({ fontSize: 4, held }), { lineHeight: 0.95 }),
    ).toBeCloseTo(9.584 / 56.25, 10)
  })

  it('does not lay text out in the inset Google keeps for itself', () => {
    // REGRESSION, and the one that reached shipped geometry. Slides draws
    // text inside 0.1in left and right and 0.05in top and bottom, and the
    // arithmetic divided the whole box — so a design filled to the budget it
    // declared overflowed. Worst on a narrow box: 8% of usable width on a
    // caption a quarter of the slide wide.
    //
    // Read as the difference the inset makes: the same box, measured with
    // the inset it actually has, holds less than the raw rectangle would.
    const raw = slot({ box: { x: 0, y: 0, w: 0.8, h: 0.3 }, fontSize: 4 })
    const wider = slot({ box: { x: 0, y: 0, w: 0.82, h: 0.3 }, fontSize: 4 })
    // 2cqi more box is exactly the inset, so the wider one holds what the
    // narrower one would have held had the inset not been reserved: 80cqi of
    // usable width rather than 78, which is one more character on each of its
    // two lines.
    const across = (usable: number) => Math.floor(usable / 2)
    const overTwoLines = (fits: number) => fits + (fits - 3)
    expect(capacityOf(raw).maxChars).toBe(overTwoLines(across(78)))
    expect(capacityOf(wider).maxChars).toBe(overTwoLines(across(80)))
  })

  it('leaves a line the characters word wrapping cannot use', () => {
    // A browser breaks at spaces and leaves the tail of each line empty; the
    // arithmetic packs characters tight. Measured at 2.3–5.6 characters over
    // real prose at every line length, so three is given back — without it a
    // box filled to its own budget wraps onto a line it does not have.
    //
    // 78cqi of usable width at 4cqi type measures 39 characters, and a line
    // that has to break claims 36. The allowance is charged once per BREAK
    // rather than once per line: a run of two lines breaks once, so it holds
    // 36 + 39 rather than 36 twice. Charged per line, NYU's own titles did
    // not fit the boxes they are set in.
    expect(capacityOf(slot({ fontSize: 4 })).maxChars).toBe(36 + 39)
  })

  it('makes a list pay for its markers and the space between its points', () => {
    // The renderer draws a bullets box as a list with a 1.4em indent for the
    // marker and 0.4em between points (`slots.tsx`), and neither is available
    // to the words. On an eleven-point list the gaps alone are four ems.
    //
    // Same box, same type: prose gets the full width and every line, a list
    // gives up the indent across and a gap between each point down.
    const prose = capacityOf(slot({ fontSize: 4 }))
    const list = capacityOf(slot({ kind: 'bullets', fontSize: 4 }))
    expect(list.maxChars).toBeLessThan(prose.maxChars! / list.maxItems!)
    // 15.875cqi of usable height is 3.97 ems; at 1.5 plus a 0.4 gap that is
    // two points, where 1.5 alone would have said two as well — the gap
    // shows on a longer list, which is where it was costing a fifth of the
    // box.
    const tall = capacityOf(
      slot({
        kind: 'bullets',
        box: { x: 0, y: 0, w: 0.8, h: 0.9 },
        fontSize: 2,
      }),
    )
    expect(tall.maxItems).toBe(
      Math.floor(((0.9 * 56.25 - 1) / 2 + 0.4) / (1.5 + 0.4)),
    )
  })

  it('grows a box by what the same estimate says it holds', () => {
    // The invariant the whole module exists for: a box given exactly its
    // budget must need no more room than it has. Asserted with the list,
    // because that is where the two readings disagreed — the capacity paid
    // for markers and gaps and the growth step did not.
    const s = slot({ kind: 'bullets', fontSize: 4 })
    const { maxChars, maxItems } = capacityOf(s)
    const needed = heightForText({
      ...s,
      held: { lines: maxItems!, longest: maxChars! },
    })
    expect(needed).toBeLessThanOrEqual(s.box.h + 1e-9)
  })

  it('is unchanged for a box that says nothing about how it is set', () => {
    // The regression this pair of settings could quietly cause: every box
    // measured before they existed must still measure the same.
    const held = { lines: 2, longest: 10 }
    expect(capacityOf(slot({ fontSize: 4 }), {})).toEqual(
      capacityOf(slot({ fontSize: 4 })),
    )
    expect(heightForText(slot({ fontSize: 4, held }), {})).toBe(
      heightForText(slot({ fontSize: 4, held })),
    )
  })
})
