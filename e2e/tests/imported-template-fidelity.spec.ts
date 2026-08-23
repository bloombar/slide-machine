/**
 * Whether a design recovered from a real presentation actually HOLDS the
 * lecture it is given (TMPL-8, TMPL-9).
 *
 * An imported design carries no hand-written budgets. Every limit it states —
 * how many characters a box takes, how many points a list holds — was
 * estimated from the box's own geometry by `server/src/import/text-metrics.ts`:
 * characters across times lines down. The generator is told those numbers and
 * the server trims to them, so nothing here tests whether the AI behaves. It
 * tests whether the ARITHMETIC was right. If a box is budgeted for more than
 * it can show, the content that fits the budget still runs past the box, and
 * the reader loses the end of it.
 *
 * That is why the transcript below is deliberately hostile. A well-behaved
 * lecture fits any layout and would certify nothing: it would exercise the
 * budgets nowhere near their edges and pass whatever the estimate said. Each
 * phrase here is chosen to land on a boundary the estimate could have got
 * wrong.
 *
 * Measured in a real browser because only a browser lays text out. And
 * measured by tree NODE (`data-node-id`) rather than by slot, because a
 * slot's wrapper hugs its text while the node is the box the design actually
 * reserves — two boxes can overlap as designed while their text wrappers
 * never touch, so measuring wrappers would report clean on a genuinely
 * broken layout.
 *
 * ## Measure the program you think you are measuring
 *
 * This suite runs the BUILT app, so a `client/dist` older than the change
 * under test can only answer questions about a different program. That has
 * already produced one confident wrong answer here: a bundle built 24 minutes
 * before the commit it was meant to exercise reported the fix as ineffective,
 * which was the result everyone half-expected and therefore the easiest to
 * believe. Before trusting a measurement of a change, confirm the change is in
 * the bundle — `grep` the built assets for something the change introduced.
 *
 * ## An affordance is not content
 *
 * Two of the five false faults this suite has produced came from the editor's
 * own invitations rather than from a lecture: an empty picture box drawing
 * "Add image" at an intrinsic size far larger than the box, and an empty text
 * box drawing "Click to add text" inside a box laid out at zero height, which
 * overflows by its whole height. Neither is anything a reader would see cut
 * off. Both are excluded by letting the app say what is furniture — the
 * `aria-hidden` it already sets, and the `slot-blank` it already marks empty
 * slots with — rather than by matching on the wording, which would break in
 * every other language. When a new false fault appears, look for the marker
 * the app already has before inventing a rule.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { faultsOn, settled } from './slide-boxes'
import { createProject } from './helpers'

const stamp = Date.now()
const password = 'sturdy-passw0rd'

/**
 * Every design the app ships, read from the templates it loads rather than
 * listed here — a fixed list would quietly stop covering a design the moment
 * one was added, which is the failure a test like this exists to prevent.
 *
 * All of them, not only imported ones. The budgets an import derives are the
 * sharpest test of the estimate, but nothing here is about imports: a
 * hand-written design can just as easily bound a box to more than it shows, or
 * put two boxes of words on top of each other. A design that ships with a
 * layout that clips or overlaps should fail here whoever wrote it.
 */
const TEMPLATES: { id: string; name: string }[] = readdirSync(
  path.resolve('../server/config/templates'),
)
  .filter(file => file.endsWith('.json'))
  .map(file =>
    JSON.parse(
      readFileSync(path.resolve('../server/config/templates', file), 'utf8'),
    ),
  )
  .map((template: { id: string; name: string }) => ({
    id: template.id,
    name: template.name,
  }))

/**
 * Phrases chosen to strain the budgets rather than to read well.
 *
 * The mock generator is content-driven (`mock-generation.ts`): a short phrase
 * becomes a title, three or more comma-separated segments become a list, and
 * anything else becomes a content slide. So the shape of each phrase decides
 * which box it lands in, and each one below targets a different way the
 * estimate can be wrong.
 */
const TRANSCRIPT: { say: string; why: string }[] = [
  {
    say: 'Pneumonoultramicroscopicsilicovolcanoconiosis',
    why: 'a title with no space in it — the estimate assumes text wraps at any point, and this offers nowhere to wrap',
  },
  {
    say: 'Rainwater harvesting reduces municipal demand, recharges depleted aquifers, buffers storm surges, cuts treatment costs, protects riparian habitat, defers capital works, and lowers household bills',
    why: 'a list past the derived maxItems, and every point long enough to test the per-point character bound',
  },
  {
    say: 'The catchment sizing method is documented at https://example.org/guidance/rainwater/catchment-sizing-for-institutional-roofs-appendix-c',
    why: 'a body with an unbreakable token far wider than its box',
  },
  {
    say: 'Storage, conveyance, filtration, disinfection, distribution, monitoring',
    why: 'six short points — a list whose item count strains maxItems while each item is trivially short',
  },
]

for (const template of TEMPLATES)
  test(`${template.id} holds a lecture written to strain it`, async ({
    page,
  }) => {
    const email = `fidelity-${template.id}-${stamp}@example.com`
    // Measured after the morph, not during it: a box read mid-flight reports a
    // position it is only passing through, so overlap and bounds would be judged
    // against geometry no reader ever sees (`layoutFlip.ts` honours this).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/register')
    await page.getByLabel('Display name').fill('Fidelity')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()

    await createProject(page, 'Fidelity')
    await page
      .getByRole('button', { name: 'Start a new lecture in Fidelity' })
      .click()
    await expect(page).toHaveURL(/\/d\/untitled-/)
    await page.getByRole('button', { name: 'Start lecture' }).click()

    await page.getByRole('button', { name: 'Lecture settings' }).click()
    await page.getByRole('tab', { name: 'Design' }).click()
    // Anchored to the start of the name: a design whose name is a prefix of
    // another's would otherwise be picked by whichever matched first.
    const pick = new RegExp(
      `^${template.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i',
    )
    await page.getByRole('radio', { name: pick }).click()
    await expect(page.getByRole('radio', { name: pick })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.getByRole('button', { name: 'Close settings' }).click()

    const slide = page.getByTestId('slide').first()
    const faults: string[] = []

    for (const [i, phrase] of TRANSCRIPT.entries()) {
      await page.getByLabel('Spoken phrase').fill(phrase.say)
      await page.getByRole('button', { name: 'Speak' }).click()
      // Let the phrase round-trip before the next one, or the submit is dropped
      await expect(slide).toHaveAttribute('data-layout', /.+/)
      await expect(page.getByText(`${i + 1} / ${i + 1}`)).toBeVisible({
        timeout: 15_000,
      })

      await settled(page)
      // Every rule for what counts as a fault lives in `slide-boxes`,
      // shared with the spec that photographs every layout.
      faults.push(...(await faultsOn(slide, `slide ${i + 1}`, phrase.why)))
    }

    // Reported together rather than one at a time: the first fault is
    // rarely the only one, and a design is fixed by seeing all of them.
    expect(faults, faults.join('\n')).toEqual([])
  })
