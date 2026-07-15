/**
 * Regression: the deck toolbar (view-mode toggle, settings, add-slide,
 * live-session) stays pinned and usable while the slide list scrolls, and
 * can be dragged anywhere in the window by its grip. It previously sat in
 * normal document flow, so scrolling down in list view carried every
 * control off-screen.
 */
import { test, expect, type Page } from '@playwright/test'

const GRIP = 'Drag to move the toolbar'

const TOOLBAR_BUTTONS = [
  'Carousel view',
  'List view',
  'Lecture settings',
  'Add slide',
  'Live session',
]

/**
 * Registers a fresh user and dictates a deck tall enough to need
 * scrolling. Each test passes its own tag: the specs run in parallel, so
 * a shared email would collide on the unique index.
 */
const buildDeck = async (page: Page, tag: string) => {
  const project = `ToolbarProj-${tag}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Toolbar Tester')
  await page
    .getByLabel('Email')
    .fill(`toolbar-${tag}-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill(project)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: project, exact: true }).click()
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)

  for (const phrase of [
    'Watermelons are warm season fruits',
    'They need full sunlight and well drained soil',
    'Sow seeds once the soil is reliably warm',
    'Harvest when the tendril nearest the fruit dries out',
  ]) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    await expect(page.getByTestId('slide')).toBeVisible()
  }

  // Close the live-session bar, then stack every slide vertically
  await page.getByRole('button', { name: 'Live session' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  return project
}

test('the toolbar stays reachable after scrolling the slide list', async ({
  page,
}) => {
  await buildDeck(page, 'reach')
  // Not one slide per phrase: the generator folds some phrases into the
  // current slide (GEN-8), so take the count it actually produced
  const built = await page.getByTestId('slide').count()
  expect(built).toBeGreaterThan(1)

  // Scroll to the last slide — far enough that an in-flow toolbar is gone
  await page.getByTestId('slide').last().scrollIntoViewIfNeeded()
  await expect(page.getByTestId('slide').last()).toBeInViewport()
  // Guard the guard: if the page never scrolled, the assertions below
  // would pass for the wrong reason
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  // toBeInViewport, not toBeVisible: a scrolled-away toolbar is still
  // "visible" to the DOM, just not on screen — which was the whole bug
  for (const name of TOOLBAR_BUTTONS) {
    await expect(page.getByRole('button', { name })).toBeInViewport()
  }

  // Reachable is not enough — the controls must still work from here
  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(built + 1)
})

test('slides scroll behind the toolbar without swallowing clicks', async ({
  page,
}) => {
  await buildDeck(page, 'clicks')
  await page.getByTestId('slide').last().scrollIntoViewIfNeeded()

  // The pinned row spans the full width; only the pill itself may take
  // pointer events, or slides passing beneath it become unclickable
  const pill = page.getByRole('button', { name: 'Add slide' })
  const box = (await pill.boundingBox())!
  const beside = await page.evaluateHandle(
    ({ x, y }) => document.elementFromPoint(x, y),
    { x: 40, y: box.y + box.height / 2 },
  )
  const tag = await beside.evaluate(el => el?.closest('header') !== null)
  expect(tag).toBe(false)
})

/** Drags the toolbar grip to a point, as a real pointer would. */
const dragGripTo = async (page: Page, x: number, y: number) => {
  const grip = page.getByRole('button', { name: GRIP })
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
}

test('the toolbar drags anywhere and stays where it is dropped', async ({
  page,
}) => {
  await buildDeck(page, 'drag')
  const grip = page.getByRole('button', { name: GRIP })
  const before = (await grip.boundingBox())!

  await dragGripTo(page, 220, 460)
  const dropped = (await grip.boundingBox())!
  expect(dropped.y).toBeGreaterThan(before.y + 100)

  // Moving it must not break the controls it carries
  const built = await page.getByTestId('slide').count()
  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(built + 1)

  // A dropped pill is viewport-fixed: scrolling leaves it exactly put
  await page.getByTestId('slide').last().scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  const scrolled = (await grip.boundingBox())!
  expect(Math.round(scrolled.y)).toBe(Math.round(dropped.y))
  await expect(page.getByRole('button', { name: 'Add slide' })).toBeInViewport()
})

test('the toolbar cannot be dragged out of the window', async ({ page }) => {
  await buildDeck(page, 'clamp')
  // Aim far past the bottom-right corner; the pill must stay reachable
  await dragGripTo(page, 5000, 5000)

  const viewport = page.viewportSize()!
  const pill = (await page
    .getByRole('button', { name: GRIP })
    .evaluate(el => el.parentElement!.getBoundingClientRect().toJSON())) as {
    x: number
    y: number
    width: number
    height: number
  }
  expect(pill.x).toBeGreaterThanOrEqual(0)
  expect(pill.y).toBeGreaterThanOrEqual(0)
  expect(pill.x + pill.width).toBeLessThanOrEqual(viewport.width)
  expect(pill.y + pill.height).toBeLessThanOrEqual(viewport.height)
  await expect(page.getByRole('button', { name: 'Add slide' })).toBeInViewport()
})

test('the toolbar cannot be dragged behind the nav', async ({ page }) => {
  await buildDeck(page, 'navband')
  const grip = page.getByRole('button', { name: GRIP })

  // Aim the grip up into the header band
  await dragGripTo(page, 400, 5)

  // The nav is h-14 (56px) and paints at z-50, over the pill's z-30
  const dropped = (await grip.boundingBox())!
  expect(dropped.y).toBeGreaterThanOrEqual(56)

  // The real proof it is not buried: a covered button cannot be clicked,
  // so this times out if the nav is painting over the toolbar
  const built = await page.getByTestId('slide').count()
  await page.getByRole('button', { name: 'Add slide' }).click({ timeout: 5000 })
  await expect(page.getByTestId('slide')).toHaveCount(built + 1)

  // And a reload must not restore it back under the header
  await page.reload()
  await expect(grip).toBeVisible()
  expect((await grip.boundingBox())!.y).toBeGreaterThanOrEqual(56)
})

test('a dragged toolbar is still there after a reload', async ({ page }) => {
  await buildDeck(page, 'reload')
  const grip = page.getByRole('button', { name: GRIP })
  const parked = (await grip.boundingBox())!

  await dragGripTo(page, 240, 500)
  const dropped = (await grip.boundingBox())!
  expect(dropped.y).toBeGreaterThan(parked.y + 100)

  await page.reload()
  await expect(grip).toBeVisible()
  const restored = (await grip.boundingBox())!
  expect(Math.round(restored.x)).toBe(Math.round(dropped.x))
  expect(Math.round(restored.y)).toBe(Math.round(dropped.y))
})

test('a new lecture starts with its toolbar pinned', async ({ page }) => {
  const project = await buildDeck(page, 'newlecture')
  const grip = page.getByRole('button', { name: GRIP })
  const parked = (await grip.boundingBox())!

  await dragGripTo(page, 240, 500)
  const dropped = (await grip.boundingBox())!
  expect(dropped.y).toBeGreaterThan(parked.y + 100)

  // The position is remembered per lecture, so a fresh one has no entry
  await page.goto('/app')
  await page.getByRole('link', { name: project, exact: true }).click()
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)

  // Parked up at the top, nowhere near where the other lecture's was left.
  // Not compared to `parked` exactly: that was measured on a scrolled page
  // with the sticky offset engaged, while a fresh lecture has no slides to
  // scroll, so the toolbar sits at its natural spot a little lower.
  const fresh = (await grip.boundingBox())!
  expect(fresh.y).toBeLessThan(150)
  expect(fresh.y).toBeLessThan(dropped.y - 200)
})

test('Escape parks a dragged toolbar back under the nav', async ({ page }) => {
  await buildDeck(page, 'park')
  const grip = page.getByRole('button', { name: GRIP })
  const parked = (await grip.boundingBox())!

  await dragGripTo(page, 240, 480)
  expect((await grip.boundingBox())!.y).toBeGreaterThan(parked.y + 100)

  await grip.press('Escape')
  const reparked = (await grip.boundingBox())!
  expect(Math.round(reparked.y)).toBe(Math.round(parked.y))
  expect(Math.round(reparked.x)).toBe(Math.round(parked.x))
})
