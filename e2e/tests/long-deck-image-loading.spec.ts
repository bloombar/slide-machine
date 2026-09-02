/**
 * Pictures in a long lecture read as a list.
 *
 * List view puts every slide of a lecture on one page. Without deferral that
 * meant a hundred-slide lecture fetched and decoded a hundred pictures the
 * moment it opened — the one cost in that view that grows with the deck, and
 * the one that matters, since a decoded photograph dwarfs the markup around
 * it. Slide images are `loading="lazy"`, and every list row (the owner's
 * draggable one included) skips its contents until scrolled to.
 *
 * Fetches are counted at the network, which is the only place the saving is
 * real: a picture the browser decided not to ask for.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures'
import { createProject } from './helpers'

test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } })

/** Long enough that all-at-once and on-demand cannot be confused. */
const SLIDE_COUNT = 120

/** A 1×1 PNG, so the run measures what was requested rather than bandwidth. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const longDeckYaml = (title: string): string =>
  [
    'version: 1',
    'kind: deck',
    `title: ${title}`,
    'templateId: default',
    'slides:',
    ...Array.from({ length: SLIDE_COUNT }, (_, i) =>
      [
        '  - layout: image-heavy',
        `    title: Slide ${i + 1}`,
        `    body: The ${i + 1}th picture worth showing.`,
        '    image:',
        `      ref: /api/files/lazy-probe-${i}.png`,
        '      source: stock',
      ].join('\n'),
    ),
  ].join('\n')

test('a long lecture in list view fetches the pictures it shows, not all of them', async ({
  page,
}) => {
  const fetched = new Set<string>()
  await page.route('**/api/files/lazy-probe-*', async route => {
    fetched.add(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PIXEL_PNG,
    })
  })

  const stamp = Date.now()
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Reader')
  await page.getByLabel('Email').fill(`lazyimg-${stamp}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'LazyProj')

  const file = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-deck-')),
    'deck.yaml',
  )
  await fs.writeFile(file, longDeckYaml('Picture Heavy Lecture'), 'utf8')
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Import a lecture' }).click()
  await page.getByLabel(/import a lecture file/i).setInputFiles(file)
  await expect(page.getByText(/^Imported /)).toBeVisible({ timeout: 60_000 })

  await page.getByRole('link', { name: 'Picture Heavy Lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  fetched.clear()

  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(SLIDE_COUNT)
  // Long enough for anything the browser meant to fetch to have been asked
  // for; a lazy image is not merely late.
  await page.waitForTimeout(2500)

  const onOpen = fetched.size
  expect(onOpen).toBeLessThan(SLIDE_COUNT / 4)

  // ...and they are deferred, not broken. Without this the assertion above
  // would pass just as well on a lecture whose pictures never load at all.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect
    .poll(() => fetched.size, { timeout: 20_000 })
    .toBeGreaterThan(onOpen)

  // The last slide's picture is one of the ones now on screen.
  const last = page.getByTestId('slide').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last.locator('img')).toHaveJSProperty('complete', true)
  expect(
    await last
      .locator('img')
      .evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0)
})
