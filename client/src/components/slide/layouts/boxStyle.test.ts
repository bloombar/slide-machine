/**
 * Every value of every style property a design can set actually reaches CSS.
 *
 * Written after `align: 'end'` was silently lost. The renderer read the
 * property — it was not forgotten, and no audit could have found it — but it
 * handled the value with a conditional over one case:
 *
 *     textAlign: style.align === 'center' ? 'center' : undefined
 *
 * `align` has three values. Two of them fell through to `undefined` and drew
 * left. Every right-ranged box in every imported design lost its alignment, on
 * every deck, while the template data was perfect and every geometry check
 * passed: the box was the right size in the right place holding the right
 * words, and the design was still wrong.
 *
 * ## The class of defect, which is narrower than "a property was dropped"
 *
 * All seventeen `BoxStyle` fields are read by the renderer — checked, none is
 * missing. So "an unread property" is not the risk. The risk is an
 * ENUM-valued property whose values are handled by a CONDITIONAL rather than
 * by a total map, because a conditional silently defaults every case its
 * author did not think of.
 *
 * That is exactly why `vAlign` survived while `align` did not, and it was not
 * luck. `vAlign` only ever went through `FLEX`, a map with an entry per
 * value, so adding a value would have shown up as `undefined` immediately.
 * `align`'s BLOCK placement went through the same map and was always right;
 * only its TEXT placement used a conditional, and only that half broke. One
 * property, two code paths, and the difference between them predicted which
 * half failed.
 *
 * So what is asserted is the property a conditional cannot satisfy by
 * accident: **no CSS property may be set for some values of an enum and left
 * undefined for others.** That is precisely what happened — `textAlign` was
 * emitted for `center` and undefined for `start` and `end` — and it is
 * general, because a conditional that forgets a case always defaults it.
 *
 * ## The obvious version of this check does not work, which is worth recording
 *
 * The first version compared the whole emitted declaration across the enum's
 * values and asserted they were pairwise distinct. **It passes on the buggy
 * implementation.** `align` reaches CSS through two properties, and
 * `alignItems` went through the total `FLEX` map and stayed correct, so all
 * three declarations differed from each other while `textAlign` was collapsing
 * two cases into one. A whole-object comparison is satisfied by any one
 * property still varying, which is the property most likely to be the one
 * that was never broken.
 *
 * Measured rather than reasoned: run against both implementations, the
 * distinctness check reported no collisions for either, while the
 * defined-for-every-value check reported `textAlign` undefined for
 * `start,end` on the buggy one and nothing on the fixed one. Distinctness is
 * kept below because it catches a total collapse, but it is the weaker rule
 * and is not what makes this suite work.
 *
 * ## What this does not cover
 *
 * That the CSS is CORRECT — only that every value of an enum is handled
 * rather than defaulted. A renderer that emitted `start` for `end` would set
 * the property for all three values and pass here, because nothing in this
 * file knows which CSS value each enum value ought to produce. That is a
 * deliberate limit: encoding the expected mapping would make this a second
 * copy of the implementation, and it would go green against whatever the
 * implementation last did.
 *
 * It also says nothing about whether the browser then DRAWS it. Emitting
 * `textAlign: end` and having the reader see a right-ranged line are
 * different claims, and only a browser can settle the second.
 */
import { describe, expect, it } from 'vitest'
import { contentStyle, surfaceStyle, typeStyle } from './boxStyle'
import type { ThemeColors } from '../theme'

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
  imageBackground: '#222',
  link: '#0af',
  penColor: '#0ff',
  highlighterColor: '#ff0',
}

/** The properties whose values are drawn from a fixed set. These are the ones
 * a conditional can quietly under-handle. */
const ENUMS = [
  { field: 'align', values: ['start', 'center', 'end'] },
  { field: 'vAlign', values: ['start', 'center', 'end'] },
] as const

describe('every value of an enum style property reaches CSS', () => {
  for (const { field, values } of ENUMS) {
    it(`${field}: no CSS property is set for some of its values and not others`, () => {
      // The rule that catches a conditional which forgot a case. A property
      // the renderer emits for one value and defaults for another is a value
      // being silently dropped, whatever the rest of the declaration does.
      const emitted = values.map(
        value =>
          contentStyle({ [field]: value }, colors) as Record<string, unknown>,
      )
      const everyProperty = new Set(emitted.flatMap(e => Object.keys(e)))
      for (const property of everyProperty) {
        const setFor = values.filter(
          (_, i) => emitted[i]![property] !== undefined,
        )
        const unsetFor = values.filter(
          (_, i) => emitted[i]![property] === undefined,
        )
        expect(
          unsetFor.length === 0 || setFor.length === 0,
          `${property} is emitted for ${field}=${JSON.stringify(setFor)} but ` +
            `left undefined for ${JSON.stringify(unsetFor)} — those values ` +
            `are being defaulted rather than handled, which is exactly how ` +
            `align:end was lost`,
        ).toBe(true)
      }
    })

    it(`${field}: its values do not all collapse to one declaration`, () => {
      // The weaker companion to the rule above: it catches a property handled
      // by no branch at all. It does NOT catch a partially-handled enum —
      // see the header — so it is here for completeness, not as the check
      // this suite rests on.
      const emitted = values.map(value =>
        JSON.stringify(contentStyle({ [field]: value }, colors)),
      )
      expect(
        new Set(emitted).size,
        `every value of ${field} emits the same CSS`,
      ).toBeGreaterThan(1)
    })
  }

  /**
   * The boolean properties, which are a milder version of the same thing: a
   * conditional over a boolean at least covers both cases, but only if the
   * false case is meant to be the default rather than an explicit value.
   */
  it('caps and italic each change the emitted type', () => {
    const plain = JSON.stringify(typeStyle({}, colors))
    expect(JSON.stringify(typeStyle({ caps: true }, colors))).not.toEqual(plain)
    expect(JSON.stringify(typeStyle({ italic: true }, colors))).not.toEqual(
      plain,
    )
  })

  /**
   * The measured properties. These cannot be under-handled the way an enum
   * can — they are passed through — but a units mistake or a dropped field
   * would show here, and they are cheap to pin.
   */
  it('every measured surface property reaches CSS', () => {
    const emitted = surfaceStyle(
      {
        background: '#123456',
        padding: 2,
        radius: 3,
        borderWidth: 4,
        borderColor: '#654321',
      },
      colors,
    )
    expect(emitted.backgroundColor).toBe('#123456')
    expect(emitted.paddingLeft).toBe('2cqi')
    expect(emitted.borderRadius).toBe('3cqi')
    expect(emitted.borderWidth).toBe('4cqi')
    // A border with a width and no style draws nothing at all.
    expect(emitted.borderStyle).toBe('solid')
    expect(emitted.borderColor).toBe('#654321')
  })

  it('a per-axis padding wins over the uniform one', () => {
    const emitted = surfaceStyle({ padding: 1, paddingX: 5 }, colors)
    expect(emitted.paddingLeft).toBe('5cqi')
    expect(emitted.paddingRight).toBe('5cqi')
    // and the axis that was not overridden keeps the uniform value
    expect(emitted.paddingTop).toBe('1cqi')
  })
})
