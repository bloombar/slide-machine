/**
 * Whether a shipped design's leading came from the deck it was derived from
 * (TMPL-8).
 *
 * The check that ties the artifact to the world, and the one thing that can
 * catch a template file nobody re-derived after the importer changed.
 *
 * `budget-consistency.test.ts` asks whether the file agrees with itself, and
 * that turned out not to be enough — a uniformly stale file is perfectly
 * self-consistent. The old importer wrote `1.5` into every text style AND
 * derived every budget from `1.5`, so recomputing capacity from the file's own
 * leading reproduced the stored numbers exactly and the check went green on a
 * file that was wrong throughout. Verified, not supposed: this design passed
 * that check 33 boxes out of 33 while its leading was wrong on all of them.
 *
 * Staleness is a disagreement between the file and the world. Nothing that
 * only reads the file can see it. So this reads the source deck.
 *
 * ## Why it needs no layout pairing
 *
 * The obvious version re-imports the fixture and diffs, which drowns in
 * differences that are not faults: the shipped design names its layouts
 * semantically, carries conventional layouts the deck had no slide for, and
 * has had its picture URLs rewritten. None of that is in scope here, because
 * this compares no layouts at all.
 *
 * Leading is a pure number. Every distinct one in the design must be some
 * paragraph spacing the deck actually states, converted — Google writes it as
 * a percentage, so `lineSpacing / 100`, times the constant that turns a
 * percentage into the CSS multiple a browser lays text out with. That is one
 * arithmetic relation between two files, and it survives every rename,
 * reorder and re-derivation there will ever be.
 *
 * ## Why it fires on the actual defect
 *
 * `1.5` is not `SPACING_TO_LEADING` times any spacing this deck contains. Its
 * nearest neighbour is `125 → 1.495`, which misses by 0.005 — five times the
 * tolerance below, so the failure is unambiguous rather than marginal. That is
 * the fact this whole line of work started from: the value 150 appears nowhere
 * in NYU's deck, and a design led at 1.5 could not have got it from there.
 *
 * ## Scope, which is a real limit and not a weakness
 *
 * Only a built-in with a captured source fixture can be checked this way, so
 * this covers `nyu-bold` alone. A hand-authored design has no source to be
 * faithful to, and a derived design whose deck was never captured has nothing
 * to compare against. Adding a design here means capturing its deck
 * (`scripts/capture-google-presentation.mjs`), which is the same thing as
 * being able to make the claim at all.
 *
 * ## What passing does NOT prove
 *
 * That each box got the RIGHT one of the deck's spacings — only that every
 * leading in the design is one the deck states. A design that swapped its
 * title and body leadings would pass. Catching that needs the layout pairing
 * this deliberately avoids, and the boxes are separately measured by eye
 * against the source.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listBuiltinTemplates } from './builtin'

/**
 * What turns Google's paragraph spacing into a CSS line-height multiple.
 *
 * Measured from the source deck rather than derived: a percentage in Slides
 * and a multiple in CSS are not the same quantity, because they are taken
 * against different heights. Stated to the precision it was measured to;
 * nothing here depends on the last digit, since the tolerance below is more
 * than an order of magnitude larger than its uncertainty.
 */
const SPACING_TO_LEADING = 1.196

/**
 * How far a stored leading may sit from the value the deck implies.
 *
 * Three things have to fit inside it: the template rounds its leadings to
 * three decimals (up to 0.0005), the constant above carries an uncertainty of
 * about 0.0006 which reaches 0.00075 at the largest spacing here, and the
 * arithmetic itself is exact. That is roughly 0.0013, so 0.002 holds them
 * with room.
 *
 * The upper bound is what makes the check worth having: it has to stay well
 * below 0.005, the distance from `1.5` to its nearest legitimate neighbour,
 * or the defect this exists to catch would pass.
 */
const TOLERANCE = 0.002

/** Designs whose source deck has been captured, and the fixture for each. */
const WITH_SOURCE: { id: string; fixture: string }[] = [
  { id: 'nyu-bold', fixture: '../../test/fixtures/presentation-nyu-bold.json' },
]

/**
 * Every paragraph spacing the deck states, as written.
 *
 * Read out of the raw JSON by pattern rather than by walking the structure:
 * spacing is set at several depths — on a master, a layout, a placeholder, a
 * run — and what matters is the set of values the deck uses, not where each
 * one sits. A walk would have to know every shape Google nests them in, and
 * would silently miss any it did not.
 */
const spacingsIn = (raw: string): number[] => [
  ...new Set(
    [...raw.matchAll(/"lineSpacing"\s*:\s*([0-9.]+)/g)].map(match =>
      Number.parseFloat(match[1]!),
    ),
  ),
]

describe('a derived design against its source deck', () => {
  for (const { id, fixture } of WITH_SOURCE) {
    const template = listBuiltinTemplates().find(t => t.id === id)

    it(`${id} is installed and has a source fixture to check against`, () => {
      // Both premises, so neither can go missing and leave the case below
      // passing over nothing.
      expect(template, `${id} is not among the built-ins`).toBeDefined()
      const spacings = spacingsIn(
        readFileSync(new URL(fixture, import.meta.url), 'utf8'),
      )
      expect(
        spacings.length,
        `${fixture} states no lineSpacing at all, so there is nothing to ` +
          `check the design's leading against`,
      ).toBeGreaterThan(0)
    })

    it(`${id} takes every leading from its source deck`, () => {
      const styles = template?.theme?.textStyles ?? {}
      const spacings = spacingsIn(
        readFileSync(new URL(fixture, import.meta.url), 'utf8'),
      )
      const supported = spacings.map(s => (s / 100) * SPACING_TO_LEADING)

      const wrong: string[] = []
      let checked = 0
      for (const [role, style] of Object.entries(styles)) {
        const leading = style.lineHeight
        // A style that states no leading follows whatever the renderer
        // defaults to and makes no claim about the deck.
        if (typeof leading !== 'number') continue
        checked++
        const nearest = supported.reduce(
          (best, value) =>
            Math.abs(value - leading) < Math.abs(best - leading) ? value : best,
          supported[0]!,
        )
        if (Math.abs(nearest - leading) > TOLERANCE) {
          const spacing = spacings[supported.indexOf(nearest)]
          wrong.push(
            `${role} is led at ${leading}, which is not any spacing the deck ` +
              `states times ${SPACING_TO_LEADING}. Nearest is ` +
              `${spacing} → ${nearest.toFixed(4)}, off by ` +
              `${Math.abs(nearest - leading).toFixed(4)}`,
          )
        }
      }

      // The premise: leadings were actually compared. A theme whose styles
      // all omitted a leading would report no disagreement and mean nothing.
      expect(
        checked,
        `${id} states no leading on any text style, so this case compared ` +
          `nothing against the deck`,
      ).toBeGreaterThan(0)

      expect(
        wrong,
        `${id} is led at values its source deck does not contain. A leading ` +
          `that came from nowhere in the deck means the template was ` +
          `derived by arithmetic the importer no longer performs — ` +
          `regenerate it. Deck states spacings: ` +
          `${spacings.join(', ')}\n\n${wrong.join('\n')}`,
      ).toEqual([])
    })
  }

  /**
   * The check above, shown to be capable of failing.
   *
   * Built rather than borrowed. The real deck was over-budgeted when this
   * work started and is not any more, so using it as a control would mean the
   * control expired the moment the defect was fixed — and a check whose
   * ability to fire depends on a bug being present is a check that stops
   * being one as soon as it succeeds.
   *
   * `1.5` is the actual historical value, so this is the real regression, not
   * an invented one.
   */
  it('rejects a leading the deck does not contain', () => {
    const spacings = [80, 85, 100, 115, 125]
    const supported = spacings.map(s => (s / 100) * SPACING_TO_LEADING)
    const nearestTo = (leading: number) =>
      Math.min(...supported.map(value => Math.abs(value - leading)))

    // The value every imported design used to be re-led to.
    expect(nearestTo(1.5)).toBeGreaterThan(TOLERANCE)
    // And the values a deck-derived design legitimately carries.
    for (const leading of [1.017, 1.196, 1.495])
      expect(nearestTo(leading), `${leading} should be accepted`).toBeLessThan(
        TOLERANCE,
      )
  })
})
