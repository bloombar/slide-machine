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
import { test, expect, type Locator, type Page } from './fixtures'
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

/** Rounding slack, as a fraction of the slide. Sub-pixel differences are not
 * a design fault. */
const EPS = 0.004

/**
 * Overflow below this is layout noise rather than hidden content, in pixels.
 *
 * Chromium reports `scrollWidth` a few pixels over `clientWidth` on text boxes
 * that are not clipping anything — measured at a constant 4px on boxes of
 * 1527px and 139px alike, with identical scroll and client heights. A real
 * clip is not constant: it scales with the words that did not fit, and hides
 * hundreds of pixels rather than four. Eight is about one character at the
 * smallest size this app sets text in, so nothing a reader could notice is
 * dismissed.
 */
const NOISE = 8

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

/** Every box the design reserves on the visible slide, as fractions of the
 * slide, with how far its own content runs past it. */
/**
 * Waits for the slide itself to stop moving.
 *
 * Not "no animation anywhere": the app keeps indefinitely-repeating ones
 * running elsewhere on the page — a pulse on the record indicator, and the
 * like — so waiting on all of them never returns. Only animations whose
 * target is inside the slide count, and endlessly repeating ones are ignored
 * however they are scoped, since they are never going to finish.
 *
 * Belt and braces over `prefers-reduced-motion`, which the app already
 * honours, so a timeout here is not worth failing a run over.
 */
const settled = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const slide = document.querySelector('[data-testid="slide"]')
        if (!slide) return false
        return document.getAnimations().every(animation => {
          const effect = animation.effect as KeyframeEffect | null
          const target = effect?.target ?? null
          if (!target || !slide.contains(target)) return true
          if (effect?.getTiming().iterations === Infinity) return true
          return animation.playState !== 'running'
        })
      },
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {})

const boxesOf = (slide: Locator) =>
  slide.evaluate(el => {
    const frame = el.getBoundingClientRect()
    return [...el.querySelectorAll('[data-node-id]')]
      .filter(node => !node.querySelector('[data-node-id]'))
      .map(node => {
        const r = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          id: node.getAttribute('data-node-id') ?? '?',
          x: (r.x - frame.x) / frame.width,
          y: (r.y - frame.y) / frame.height,
          w: r.width / frame.width,
          h: r.height / frame.height,
          // What the box hides: content taller or wider than the box itself.
          // Only meaningful where the box actually CLIPS: `scrollWidth`
          // exceeds `clientWidth` on any element whose content spills, but
          // under `overflow: visible` the words are still drawn and still
          // read. Spill that leaves the slide is caught by the bounds check
          // instead, which is where it actually costs the reader something.
          clips: /hidden|auto|scroll|clip/.test(
            [style.overflow, style.overflowX, style.overflowY].join(' '),
          ),
          overflowY: node.scrollHeight - node.clientHeight,
          overflowX: node.scrollWidth - node.clientWidth,
          // Whether the box is showing WORDS. A full-bleed picture sitting
          // under a title overlaps it completely and is the design working,
          // not failing — so only text over text is a fault.
          // A box is "showing words" only if it holds text the lecture put
          // there. Two things else look like text and are not: a picture,
          // which carries alt text and printed credits; and an UNFILLED slot,
          // which draws an "Add image" affordance at an intrinsic size the
          // box may be far too small for — so every empty picture box would
          // report as clipped forever.
          //
          // A third is an empty TEXT slot, which invites an author to "Click
          // to add text" and carries `slot-blank` to say so. Its prompt is not
          // the lecture's words, and it is drawn at a size the box may have no
          // room for — one such box is laid out at zero height, so its
          // invitation overflows by its whole height and reads as content
          // being cut off.
          //
          // All are excluded by reading the box the way a screen reader does,
          // ignoring anything marked `aria-hidden`, and by dropping the
          // blank-slot prompt the app already marks as furniture. That is the same
          // judgement the app already makes about what is content and what is
          // furniture, rather than a second opinion of ours that could drift
          // from it — and it needs no knowledge of the affordance's wording,
          // so it holds in any language.
          hasText: (() => {
            if (node.querySelector('img') || node.tagName === 'IMG')
              return false
            const clone = node.cloneNode(true) as HTMLElement
            clone
              .querySelectorAll('[aria-hidden="true"], .slot-blank')
              .forEach(furniture => furniture.remove())
            return (clone.textContent ?? '').trim().length > 0
          })(),
        }
      })
  })

type Box = Awaited<ReturnType<typeof boxesOf>>[number]

/** How much of the slide two boxes share. Zero when they merely touch. */
const overlapArea = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > EPS && h > EPS ? w * h : 0
}

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
      const boxes = await boxesOf(slide)
      expect(boxes.length, `slide ${i + 1} reserved no boxes`).toBeGreaterThan(
        0,
      )

      // Nothing clipped: a box budgeted for more than it shows loses the end of
      // whatever it was given, silently
      for (const box of boxes) {
        // Clipping is only a fault where WORDS are being hidden. A picture in a
        // box it does not share the proportions of is cropped by design — that
        // is what `object-fit: cover` is for — and it reports exactly the same
        // way, so checking pictures would flag every image layout forever.
        if (
          box.hasText &&
          box.clips &&
          (box.overflowY > NOISE || box.overflowX > NOISE)
        )
          faults.push(
            `slide ${i + 1} "${box.id}" hides its content ` +
              `(${box.overflowX}px wide, ${box.overflowY}px tall) — ${phrase.why}`,
          )
        // Nothing off the slide
        if (
          box.x < -EPS ||
          box.y < -EPS ||
          box.x + box.w > 1 + EPS ||
          box.y + box.h > 1 + EPS
        )
          faults.push(
            `slide ${i + 1} "${box.id}" runs off the slide ` +
              `(x ${box.x.toFixed(3)} y ${box.y.toFixed(3)} ` +
              `w ${box.w.toFixed(3)} h ${box.h.toFixed(3)})`,
          )
      }

      // Nothing overlapping — text over text only. An imported design routinely
      // lays a title over a full-slide photograph, and flagging that would bury
      // the real faults in noise from designs that are working correctly.
      const worded = boxes.filter(box => box.hasText)
      for (let a = 0; a < worded.length; a++)
        for (let b = a + 1; b < worded.length; b++) {
          const shared = overlapArea(worded[a]!, worded[b]!)
          if (shared > 0)
            faults.push(
              `slide ${i + 1} "${worded[a]!.id}" and "${worded[b]!.id}" ` +
                `overlap over ${(shared * 100).toFixed(1)}% of the slide ` +
                `— both are showing text`,
            )
        }
    }

    // Reported together rather than one at a time: the first fault is rarely
    // the only one, and a design is fixed by seeing all of them at once
    expect(faults, faults.join('\n')).toEqual([])
  })
