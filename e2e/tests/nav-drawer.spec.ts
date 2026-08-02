/**
 * E2E for the primary-nav drawer against the built app, where the real CSS
 * decides the geometry: opening it pushes the page aside rather than
 * covering it, the toggle stays at the exact spot it was clicked so a
 * second click closes it without moving the cursor, the links clear the
 * header, and the sticky header survives the shift.
 *
 * Signed out is enough — the drawer is the same control on both shells.
 */
import { test, expect, type Locator } from '@playwright/test'

/** Bounding box of a locator, failed loudly rather than nullable. */
const box = async (locator: Locator) => {
  const b = await locator.boundingBox()
  expect(b).not.toBeNull()
  return b!
}

test('the drawer pushes the page aside and leaves the toggle where it was', async ({
  page,
}) => {
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Menu' })
  const brand = page.locator('header a').first()

  const toggleClosed = await box(toggle)
  const brandClosed = await box(brand)

  await toggle.click()
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeVisible()
  // Wait out the slide
  await page.waitForTimeout(500)

  // The page moved by the drawer's width; the toggle did not move at all
  const brandOpen = await box(brand)
  expect(brandOpen.x - brandClosed.x).toBe(256)
  expect(await box(toggle)).toEqual(toggleClosed)
  await expect(toggle).toHaveCount(1)

  // The panel is against the left edge, its links below the header
  const panel = await box(page.locator('[role="menu"]').first())
  expect(panel.x).toBe(0)
  expect(panel.width).toBe(256)
  const home = await box(page.getByRole('menuitem', { name: 'Home' }))
  expect(home.y).toBeGreaterThanOrEqual(56)

  // Scrolling still parks the header at the top, transform and all
  await page.evaluate(() => window.scrollTo(0, 400))
  expect((await box(page.locator('header'))).y).toBe(0)

  // A second click in the same place puts everything back
  await toggle.click()
  await page.waitForTimeout(500)
  expect(await box(brand)).toEqual(brandClosed)
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeHidden()
})
