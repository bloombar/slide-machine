/**
 * A measurement, not a test: what one box actually does in a browser.
 *
 * Written to settle a specific disagreement. The importer's arithmetic
 * accounts for `list.bullets` landing at about 0.8 scale; the browser puts it
 * at the 0.4 floor with content still hidden. A factor of two is not a
 * modelling refinement, so rather than stretch either side to meet the other
 * this reports the numbers the model is built from and lets them decide it.
 *
 * The specific hypothesis it exists to test: **a per-item gap that does not
 * scale with the type.** A gap fixed in absolute units is a small fraction of
 * a box at full size and a large one at two fifths, so it would be invisible
 * in the arithmetic and dominant under shrink — which is the shape of an
 * error that only appears once something else has already shrunk.
 *
 * It asserts almost nothing on purpose. A probe that fails is a probe whose
 * output you do not get, and the output is the point. The one thing it does
 * assert is that it found the box at all, because an empty report and a
 * healthy one would otherwise look identical.
 *
 * ## It does not run by default, and that is deliberate
 *
 * A file that asserts only "I measured something" is a test that can never
 * fail. Left in the default run it would be a permanent green sitting among
 * real checks, which is the exact artifact the rest of this directory exists
 * to avoid — and the next person to read the suite would count it as
 * coverage.
 *
 * So it SKIPS unless asked for, and skips loudly rather than passing:
 *
 *     DIAGNOSE=1 npx playwright test tests/diagnose-box.spec.ts
 *
 * Point it elsewhere by editing `LAYOUTS` below; it fills every slot of each
 * named layout to that slot's own declared budget and dumps what the browser
 * did with it.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from './fixtures'
import { settled } from './slide-boxes'
import { createProject, pickLayout } from './helpers'

const OUT = path.resolve(process.env.DIAGNOSE_OUT ?? 'artifacts/diagnose')

interface SlotSpec {
  name: string
  kind: string
  label: string
  multiline?: boolean
  maxChars?: number
  maxItems?: number
}

const TEMPLATE = JSON.parse(
  readFileSync(
    path.resolve('../server/config/templates/nyu-bold.json'),
    'utf8',
  ),
) as {
  name: string
  layouts: { type: string; label: string; slots?: SlotSpec[] }[]
}

const WORDS = ['ridge', 'apply', 'gauge', 'jetty', 'query', 'plumb', 'gravy']

/** Text of exactly `chars` characters, built to wrap. */
const fill = (chars: number): string => {
  let text = ''
  for (let i = 0; text.length < chars; i++)
    text += (text ? ' ' : '') + WORDS[i % WORDS.length]
  return text.slice(0, chars).trimEnd().padEnd(chars, 'y')
}

/**
 * Everything about every box that could bear on why it shrank.
 *
 * Read off the rendered box rather than derived: the whole point is to
 * compare what the browser did against what the estimate predicted, and a
 * number computed here from the same formula as the estimate would agree with
 * it by construction.
 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const slide = document.querySelector('[data-testid="slide"]')
    if (!slide) return []
    return [...slide.querySelectorAll('[data-node-id]')]
      .filter(node => !node.querySelector('[data-node-id]'))
      .map(node => {
        const cs = getComputedStyle(node)
        const items = [...node.querySelectorAll('li')]
        // Line boxes, counted from the geometry rather than assumed: a Range
        // over the contents reports one client rect per rendered line.
        const range = document.createRange()
        range.selectNodeContents(node)
        const lines = range.getClientRects().length
        range.detach()
        return {
          id: node.getAttribute('data-node-id') ?? '?',
          fitScale: Number.parseFloat(
            cs.getPropertyValue('--fit-scale').trim() || '1',
          ),
          fontSizePx: Number.parseFloat(cs.fontSize),
          lineHeightPx: Number.parseFloat(cs.lineHeight),
          rowGapPx: Number.parseFloat(cs.rowGap || '0') || 0,
          gapPx: Number.parseFloat(cs.gap || '0') || 0,
          paddingTopPx: Number.parseFloat(cs.paddingTop || '0') || 0,
          paddingBottomPx: Number.parseFloat(cs.paddingBottom || '0') || 0,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          overflowY: node.scrollHeight - node.clientHeight,
          listItems: items.length,
          // Each point's own height and the gap the browser actually left
          // between consecutive ones — the number the hypothesis is about.
          itemHeights: items.map(li => li.getBoundingClientRect().height),
          itemGaps: items.slice(1).map((li, i) => {
            const prev = items[i]!.getBoundingClientRect()
            return li.getBoundingClientRect().top - prev.bottom
          }),
          lines,
          overflow: cs.overflow,
        }
      })
  })

/** Which layouts to measure. Edit to point the probe at a different box. */
const LAYOUTS = ['code', 'formula', 'image-heavy', 'big-number', 'image-full']

test('measures the boxes a design draws', async ({ page }) => {
  // Skipped rather than passed when not asked for: a permanent green is worth
  // less than nothing, and "not run" must never read as "checked and fine".
  test.skip(
    !process.env.DIAGNOSE,
    'a probe, not a check — run with DIAGNOSE=1 to collect box measurements',
  )
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const email = `diag-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Diag')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Diag')
  await page
    .getByRole('button', { name: 'Start a new lecture in Diag' })
    .click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('radio', { name: new RegExp(TEMPLATE.name, 'i') })
    .click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByLabel('Spoken phrase').fill('Opening')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 })

  const slide = page.getByTestId('slide').first()
  const report: Record<string, unknown> = {}
  const landed: string[] = []

  for (const type of LAYOUTS) {
    const layout = TEMPLATE.layouts.find(l => l.type === type)
    if (!layout) continue
    await page.getByRole('button', { name: 'Options for slide 1' }).click()
    await page.getByRole('menuitem', { name: 'Change layout' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
    await expect(dialog).toBeVisible()
    await pickLayout(dialog, layout.label)
    await expect(slide).toHaveAttribute('data-layout', type)
    await page
      .getByText(/Filled the boxes this layout added/)
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => {})

    for (const slot of layout.slots ?? []) {
      const label = slot.label ?? slot.name
      const box = page.getByTitle(`Click to edit ${label}`).first()
      if (!(await box.count())) continue
      const text =
        slot.kind === 'bullets'
          ? Array.from({ length: slot.maxItems ?? 3 }, () =>
              fill(slot.maxChars ?? 40),
            ).join('\n')
          : slot.kind === 'math'
            ? 'E = mc^2'
            : slot.kind === 'code'
              ? 'def gauge(q):\n    return q * 2'
              : fill(slot.maxChars ?? 40)
      await box.click()
      await page.getByRole('textbox', { name: label }).fill(text)
      await page.keyboard.press(
        slot.multiline || slot.kind === 'bullets'
          ? 'ControlOrMeta+Enter'
          : 'Enter',
      )
      // Confirm it ARRIVED. The first run of this probe reported
      // `list.bullets` at scale 1 with nine points' worth of budget in it —
      // and `li=0`, because the edit never landed. An unfilled box measures
      // as a perfectly healthy one, which is the whole failure this file
      // exists to investigate, reproduced by the file itself.
      await expect(page.getByTestId('slide').first()).toContainText(
        text.slice(0, 20).trim(),
        { timeout: 10_000 },
      )
      landed.push(`${type}.${slot.name}`)
    }
    await settled(page)
    report[type] = {
      declared: layout.slots,
      filled: landed.filter(n => n.startsWith(`${type}.`)),
      boxes: await measure(page),
    }
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    path.join(OUT, 'boxes.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  )
  // The only assertion: that something was measured. An empty report and a
  // healthy one look identical from outside, which is the failure this whole
  // exercise is about.
  expect(Object.keys(report).length, 'no layout was measured').toBeGreaterThan(
    0,
  )
})
