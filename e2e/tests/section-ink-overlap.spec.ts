/**
 * A measurement, not a check: do the section divider's two texts actually
 * touch?
 *
 * `audit.test.ts` reports NYU Bold's section `title` and `number` overlapping
 * over 6.1% of the slide, and it is right about the RECTANGLES — the title's
 * box ends at 0.447 and the numeral's begins at 0.323, so the design's own
 * two boxes intersect and no arrangement reproduces the deck without that.
 * The question the audit cannot answer is whether the INK intersects, which
 * is the only version a reader can see.
 *
 * ## Why the gate's own overlap rule cannot answer it
 *
 * `slide-boxes` compares `textBox`, the bounding rectangle of a Range over
 * the box's contents. That is the LINE BOX, not the ink. The two differ by
 * exactly the quantity this design is unusual in: the title is led at 0.957,
 * tighter than the face's natural box, so its glyphs sit OUTSIDE the line
 * boxes that contain them — its ink reaches below what a Range reports. The
 * numeral is led at 1.196 and sits inside its own. Comparing line boxes here
 * would answer a different question in both directions at once.
 *
 * So this measures ink, from the face's own metrics as the browser resolved
 * them: `measureText` reports `actualBoundingBoxAscent` and
 * `actualBoundingBoxDescent` for the exact string, at the exact size and
 * weight, in the exact family the box computed to. The baseline of each
 * rendered line is placed from the font's own ascent and descent and the
 * half-leading CSS distributes, and the ink rectangle is taken from there.
 *
 * ## The controls, which are what make an answer of "no" mean anything
 *
 * A measurement that reports "they do not touch" is worthless unless it can
 * report that they do. So the numeral's box is moved and the same
 * measurement re-run:
 *
 *   as drawn   the design's own geometry — the question
 *   raised     the numeral moved up into the title — MUST report a touch
 *   dropped    the numeral moved well below it — MUST report none
 *
 * If the raised case does not report an intersection, this file is measuring
 * nothing and its answer to the real case should be discarded.
 *
 *     INK_PROBE=1 npx playwright test tests/section-ink-overlap.spec.ts
 *
 * Skipped otherwise, loudly. It asserts only that it found both boxes and
 * that the controls behaved, because the numbers are the point.
 */
import { test, expect } from './fixtures'
import { settled } from './slide-boxes'
import { createProject } from './helpers'

const TITLE = process.env.PROBE_TITLE ?? 'PRESENTATION PART ONE TITLE'
const NUMBER = process.env.PROBE_NUMBER ?? '01'
/** Which two boxes, and which layout. Defaults to the section divider. */
const LAYOUT = process.env.PROBE_LAYOUT ?? 'section'
const LAYOUT_LABEL = process.env.PROBE_LAYOUT_LABEL ?? 'Section divider'
const A_LABEL = process.env.PROBE_A_LABEL ?? 'Part title'
const B_LABEL = process.env.PROBE_B_LABEL ?? 'Part number'

/** The ink rectangles of every rendered line of a box, as fractions of the
 * slide. */
const inkOf = (id: string) => `
(() => {
  const slide = document.querySelector('[data-testid="slide"]')
  const frame = slide.getBoundingClientRect()
  const node = [...slide.querySelectorAll('[data-node-id]')]
    .filter(n => !n.querySelector('[data-node-id]'))
    .find(n => (n.textContent ?? '').includes(${JSON.stringify(id)}))
  if (!node) return null
  const cs = getComputedStyle(node)
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
  const text = (node.textContent ?? '').trim()
  const m = ctx.measureText(text)
  // Where the baseline sits inside a line box: CSS splits the difference
  // between the line height and the font's own box above and below it.
  const fontAscent = m.fontBoundingBoxAscent
  const fontDescent = m.fontBoundingBoxDescent
  const range = document.createRange()
  range.selectNodeContents(node)
  const lines = [...range.getClientRects()].filter(r => r.height > 0)
  range.detach()
  // One rect per line: several fragments can share a top, so they are merged.
  const byTop = new Map()
  for (const r of lines) {
    const key = Math.round(r.top)
    const prev = byTop.get(key)
    byTop.set(key, prev
      ? { top: r.top, height: Math.max(prev.height, r.height),
          left: Math.min(prev.left, r.left), right: Math.max(prev.right, r.right) }
      : { top: r.top, height: r.height, left: r.left, right: r.right })
  }
  const ink = [...byTop.values()].map(r => {
    const baseline = r.top + (r.height - (fontAscent + fontDescent)) / 2 + fontAscent
    return {
      left: (r.left - frame.x) / frame.width,
      right: (r.right - frame.x) / frame.width,
      top: (baseline - m.actualBoundingBoxAscent - frame.y) / frame.height,
      bottom: (baseline + m.actualBoundingBoxDescent - frame.y) / frame.height,
    }
  })
  return {
    font: ctx.font,
    text,
    lineBox: { top: (Math.min(...lines.map(r => r.top)) - frame.y) / frame.height,
               bottom: (Math.max(...lines.map(r => r.bottom)) - frame.y) / frame.height },
    ink,
  }
})()`

const intersects = (
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): number => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

test('measures whether the divider’s two texts touch', async ({ page }) => {
  test.skip(!process.env.INK_PROBE, 'a probe — run with INK_PROBE=1')
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const email = `ink-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Ink')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Ink')
  await page.getByRole('button', { name: 'Start a new lecture in Ink' }).click()
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

  for (const [label, value] of [
    [A_LABEL, TITLE],
    [B_LABEL, NUMBER],
  ] as [string, string][]) {
    const box = page.getByTitle(`Click to edit ${label}`).first()
    await expect(box).toBeVisible()
    await box.click()
    const editor = page.getByRole('textbox', { name: label })
    await editor.fill(value)
    await editor.evaluate(el => (el as HTMLElement).blur())
    await expect(slide).toContainText(value.slice(0, 12), { timeout: 10_000 })
  }
  await settled(page)

  const title = (await page.evaluate(inkOf(TITLE.slice(0, 12)))) as ReturnType<
    typeof JSON.parse
  >
  const number = (await page.evaluate(inkOf(NUMBER))) as ReturnType<
    typeof JSON.parse
  >
  expect(title, 'the title box was not found').not.toBeNull()
  expect(number, 'the numeral box was not found').not.toBeNull()

  let worst = 0
  for (const a of title.ink)
    for (const b of number.ink) worst = Math.max(worst, intersects(a, b))

  console.log(
    'INK PROBE ' +
      JSON.stringify({ title, number, inkOverlapOfSlide: worst }, null, 2),
  )
  console.log(
    `INK VERDICT  ${worst > 0 ? 'TOUCHES' : 'CLEAR'} — ` +
      `ink overlap ${(worst * 100).toFixed(3)}% of the slide; ` +
      `title ink bottom ${Math.max(...title.ink.map((r: { bottom: number }) => r.bottom)).toFixed(4)}, ` +
      `numeral ink top ${Math.min(...number.ink.map((r: { top: number }) => r.top)).toFixed(4)}`,
  )
})
