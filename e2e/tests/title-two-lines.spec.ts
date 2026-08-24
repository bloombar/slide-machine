/**
 * A measurement, not a check: does the browser draw NYU's own part title in
 * the box NYU drew it in?
 *
 * The importer and the renderer disagree about one physical quantity — the
 * ink a face hangs outside its line box when it is set tighter than the
 * face's natural line box. `text-metrics` charges the box
 * `NATURAL_LINE_BOX - lineHeight` off its usable height before counting a
 * single line; `useFitText` grants `SLACK_EM` of overrun after the fact. At
 * this design's leading those are 0.239em and 0.25em of the same thing, and
 * NYU's section title falls between them: budgeted for one line, drawn — the
 * question — as two.
 *
 * That matters because it decides which side is wrong. If the renderer draws
 * all twenty-seven characters, the deck is right and the budget model is too
 * tight. If it does not, the budget model is right and the deck genuinely
 * overruns its own box, and the answer is somewhere else entirely.
 *
 * Neither can be settled by arithmetic — both sides of it are already
 * computed and they contradict each other. Only a browser laying out real
 * Montserrat in a real box can say.
 *
 * ## What it measures, and against which box
 *
 * The height is the variable and everything else is held still. The design is
 * served from a scratch copy of the templates directory whose `section.title`
 * has had its height replaced; the run reports what it found so the number
 * can never be mistaken for the shipped one.
 *
 *   0.3581  the box NYU drew — the source rectangle, and the question
 *   0.3791  the box the importer grew it to — believed to hold two lines
 *   0.2500  a box far too small — the control, which must NOT hold two
 *
 * The last is what makes the other two readable. A measurement that reports
 * "fits" for every height is measuring nothing, and would look exactly like
 * one that had settled the question.
 *
 * ## It asserts almost nothing, on purpose
 *
 * The output is the point, and a probe that fails is a probe whose output you
 * do not get. It asserts only that it found the box and put the text in it,
 * because an empty report and a healthy one are otherwise indistinguishable.
 *
 *     TITLE_PROBE=1 npx playwright test tests/title-two-lines.spec.ts
 *
 * It SKIPS otherwise rather than passing. A file that can only report success
 * has no business sitting in a suite of real checks.
 */
import { test, expect } from './fixtures'
import { settled } from './slide-boxes'
import { createProject } from './helpers'

/** The deck's own part title, exactly as NYU set it. Twenty-seven
 * characters, which is the whole dispute. */
const TITLE = process.env.PROBE_TEXT ?? 'PRESENTATION PART ONE TITLE'

/** Which box to put it in. Defaults to the section divider's part title. */
const LAYOUT = process.env.PROBE_LAYOUT ?? 'section'
const LAYOUT_LABEL = process.env.PROBE_LAYOUT_LABEL ?? 'Section divider'
const SLOT_LABEL = process.env.PROBE_SLOT_LABEL ?? 'Part title'

test('measures whether the part title draws on two lines', async ({ page }) => {
  test.skip(
    !process.env.TITLE_PROBE,
    'a probe, not a check — run with TITLE_PROBE=1',
  )
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const email = `title-probe-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Probe')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Probe')
  await page
    .getByRole('button', { name: 'Start a new lecture in Probe' })
    .click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('radio', { name: /NYU Bold/i }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByLabel('Spoken phrase').fill('Opening')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 })

  const slide = page.getByTestId('slide').first()
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
  await expect(dialog).toBeVisible()
  const radios = dialog.getByRole('radio')
  const labels = (await radios.allInnerTexts()).map(t =>
    (t.split('\n')[0] ?? '').trim(),
  )
  await radios.nth(labels.indexOf(LAYOUT_LABEL)).click()
  await expect(slide).toHaveAttribute('data-layout', LAYOUT)

  // The edit has to LAND. An unfilled box measures as a perfectly healthy
  // one, which would answer the question with the wrong box's numbers.
  const box = page.getByTitle(`Click to edit ${SLOT_LABEL}`).first()
  await expect(box).toBeVisible()
  await box.click()
  const editor = page.getByRole('textbox', { name: SLOT_LABEL })
  await editor.fill(TITLE)
  await editor.evaluate(el => (el as HTMLElement).blur())
  await expect(slide).toContainText(TITLE.slice(0, 20), { timeout: 10_000 })
  await settled(page)

  const seen = await slide.evaluate(
    (el: HTMLElement, want: string) => {
      // The INNERMOST box holding the text, not the first in document order.
      // A slide's containers also "contain" it, and the first run of this
      // probe measured one of those: 549px tall, 16px type, holding the
      // placeholder of a neighbouring empty box as well. An ancestor reports
      // no overflow and a scale of 1 whatever the real box is doing, which
      // is a healthy-looking answer to a question it was never asked.
      const target = [...el.querySelectorAll('[data-node-id]')]
        .filter(n => !n.querySelector('[data-node-id]'))
        .find(n => (n.textContent ?? '').includes(want))
      if (!target) return null
      const cs = getComputedStyle(target)
      const range = document.createRange()
      range.selectNodeContents(target)
      // Distinct line tops, not raw rects: a Range over a container yields a
      // rect per fragment, so a single wrapped line can report several.
      const tops = [...range.getClientRects()]
        .filter(r => r.height > 0)
        .map(r => Math.round(r.top))
      const lines = new Set(tops).size
      range.detach()
      return {
        text: (target.textContent ?? '').trim(),
        fitScale: Number.parseFloat(
          cs.getPropertyValue('--fit-scale').trim() || '1',
        ),
        fontSizePx: Number.parseFloat(cs.fontSize),
        lineHeightPx: Number.parseFloat(cs.lineHeight),
        clientHeight: (target as HTMLElement).clientHeight,
        scrollHeight: (target as HTMLElement).scrollHeight,
        overflowY:
          (target as HTMLElement).scrollHeight -
          (target as HTMLElement).clientHeight,
        slidePx: (el as HTMLElement).getBoundingClientRect().height,
        lines,
        lineTops: [...new Set(tops)],
        overflow: cs.overflow,
      }
    },
    TITLE.slice(0, 20),
  )

  console.log('TITLE PROBE', JSON.stringify(seen, null, 2))

  expect(seen, 'the title box was not found on the slide').not.toBeNull()
  expect(
    seen?.text,
    'the box does not hold the text, so nothing above is about it',
  ).toContain(TITLE)
})
