/**
 * A long lecture read in list view (WB-1 / view modes).
 *
 * The whiteboard overlay covers the slides it can be drawn on, which in list
 * view is every slide at once. A hundred slides stacked in a column is some
 * 57,000 CSS pixels tall — twice that in device pixels on a Retina display —
 * and a canvas that size is past what a browser will allocate. Chromium does
 * not report the refusal: it draws the canvas as an opaque broken-image box
 * over every slide beneath it, so a long lecture read as a list showed a
 * blank rectangle where its content should be while the same lecture read as
 * a carousel was fine.
 *
 * Only a real browser can say whether the overlay is one the graphics stack
 * will actually paint on, so that is what this asks: after switching a long
 * lecture to list view, ink put on the overlay comes back.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Locator, type Page } from './fixtures'
import { createProject } from './helpers'

// Two device pixels per CSS pixel — a Retina display, and what doubles the
// backing store the overlay asks for. At 1x this deck would stay under
// Chromium's limit and the fault would not appear at all.
test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } })

/** Slides enough to take the column past Chromium's 65,535-pixel ceiling at
 * two device pixels per CSS pixel: the column is 976px wide, so each slide is
 * 549px of 16:9 plus a 24px gap. */
const SLIDE_COUNT = 80

/** Lets the overlay's repaint — one per animation frame — catch up with a
 * scroll before anything reads pixels off it. */
const settle = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
}

/**
 * Whether the overlay has ink along the horizontal middle of a slide. Samples
 * the canvas at the slide's own position, converting through the canvas rect
 * (which is the viewport, not the column) and the device pixel ratio.
 */
const inkAcross = async (page: Page, slide: Locator): Promise<boolean> => {
  const box = (await slide.boundingBox())!
  return page.getByTestId('drawing-layer').evaluate(
    (el: HTMLCanvasElement, b) => {
      const ctx = el.getContext('2d')!
      const rect = el.getBoundingClientRect()
      const scale = el.width / rect.width
      const y = Math.round((b.y + b.height * 0.5 - rect.top) * scale)
      if (y < 0 || y >= el.height) return false
      // A drawn line is a few pixels tall and the sample is one pixel, so
      // look along a short vertical run rather than at a single point.
      for (let dy = -6; dy <= 6; dy++) {
        for (const fx of [0.4, 0.5, 0.6]) {
          const x = Math.round((b.x + b.width * fx - rect.left) * scale)
          if (x < 0 || x >= el.width) continue
          if (ctx.getImageData(x, y + dy, 1, 1).data[3]! > 0) return true
        }
      }
      return false
    },
    { x: box.x, y: box.y, width: box.width, height: box.height },
  )
}

/** A deck-export document (EXP-3) with that many slides, so the lecture is
 * built in one import rather than a slide at a time. */
const longDeckYaml = (title: string): string =>
  [
    'version: 1',
    'kind: deck',
    `title: ${title}`,
    // Not a real id: an unknown template falls back to the deployment's
    // default, which is the one this test wants anyway.
    'templateId: default',
    'slides:',
    ...Array.from({ length: SLIDE_COUNT }, (_, i) =>
      [
        '  - layout: content',
        `    title: Slide ${i + 1}`,
        `    body: The ${i + 1}th thing worth saying about long lectures.`,
      ].join('\n'),
    ),
  ].join('\n')

test('a long lecture in list view has a drawing overlay the browser can paint', async ({
  page,
}, testInfo) => {
  const stamp = Date.now()
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Reader')
  await page.getByLabel('Email').fill(`longlist-${stamp}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'LongProj')

  const file = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'long-deck-')),
    'long-deck.yaml',
  )
  await fs.writeFile(file, longDeckYaml('A Very Long Lecture'), 'utf8')

  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Import a lecture' }).click()
  await page.getByLabel(/import a lecture file/i).setInputFiles(file)
  await expect(page.getByText(/^Imported /)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'A Very Long Lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // All of them are laid out, so the column really is its full height.
  await expect(page.getByTestId('slide')).toHaveCount(SLIDE_COUNT)

  const overlay = page.getByTestId('drawing-layer')
  await expect(overlay).toBeAttached()

  const measured = await overlay.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')
    if (!ctx) return { drawable: false, reason: 'no 2d context' }
    // Whether the graphics stack will paint on this canvas at all. A canvas
    // over the size limit still hands back a context and still accepts draw
    // calls; nothing lands on it. Reading the pixel back is what tells them
    // apart — and it is the same failure that puts the blank box on screen.
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 8, 8)
    const alpha = ctx.getImageData(2, 2, 1, 1).data[3]
    return {
      drawable: alpha === 255,
      backing: { width: el.width, height: el.height },
      css: el.getBoundingClientRect().height,
      column: el.parentElement?.getBoundingClientRect().height ?? 0,
    }
  })
  await testInfo.attach('overlay', { body: JSON.stringify(measured) })

  expect(measured.drawable).toBe(true)
  // And it is viewport-sized rather than column-sized, which is why: the
  // column below it is many times taller.
  expect(measured.css!).toBeLessThanOrEqual(900)
  expect(measured.column!).toBeGreaterThan(40_000)

  // The slides themselves are still readable — nothing is drawn over them.
  await expect(page.getByText('Slide 1', { exact: true })).toBeVisible()
})

test('a mark made far down a long list lands on the slide it was drawn on', async ({
  page,
}) => {
  // A viewport-sized overlay has to be repainted as it slides over the list,
  // and a mark has to be attributed to the slide under the gesture rather
  // than to wherever the canvas happens to start. Neither question exists
  // for an overlay that spans the whole column, so both are new here.
  const stamp = Date.now()
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Marker')
  await page.getByLabel('Email').fill(`longdraw-${stamp}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'DrawProj')

  const file = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'long-draw-')),
    'long-deck.yaml',
  )
  await fs.writeFile(file, longDeckYaml('Marked Up Long Lecture'), 'utf8')
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Import a lecture' }).click()
  await page.getByLabel(/import a lecture file/i).setInputFiles(file)
  await expect(page.getByText(/^Imported /)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Marked Up Long Lecture' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(SLIDE_COUNT)

  // Deep enough that the overlay has travelled a long way from the top of
  // the column — 20,000px is past slide thirty.
  await page.evaluate(() => window.scrollTo(0, 20_000))
  await page.getByRole('button', { name: 'Pen' }).click()

  const target = page.getByTestId('slide').nth(35)
  const targetId = await target.getAttribute('data-slide-id')
  const box = (await target.boundingBox())!
  const y = box.y + box.height * 0.5

  const saved = page.waitForResponse(
    r => r.url().includes('/actions/slide.editDrawings') && r.status() === 200,
  )
  await page.mouse.move(box.x + box.width * 0.3, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 8 })
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 })
  await page.mouse.up()

  // It was attributed to the slide the pen was over, not to whichever slide
  // the overlay happens to start at.
  const savedBody = await (await saved).json()
  expect(savedBody.id).toBe(targetId)
  expect(savedBody.drawings.length).toBe(1)

  // Reload, so what is on screen next is repainted from the saved stroke
  // rather than left over from the gesture.
  const reloaded = page.waitForResponse(
    r => /\/api\/decks\//.test(r.url()) && r.status() === 200,
  )
  await page.reload()
  await reloaded
  await expect(page.getByTestId('slide')).toHaveCount(SLIDE_COUNT)
  await target.scrollIntoViewIfNeeded()
  await settle(page)

  // The mark is painted across the middle of the slide it was drawn on, and
  // nowhere on its neighbour. Sampling the canvas is the only way to ask: the
  // overlay is one canvas for the whole list, so "which slide is it on" is a
  // question about where the ink landed, not about the DOM.
  expect(await inkAcross(page, target)).toBe(true)
  expect(await inkAcross(page, page.getByTestId('slide').nth(34))).toBe(false)
})
