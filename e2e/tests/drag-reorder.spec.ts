/**
 * Regression: pointer-based drag reordering (the keyboard path is
 * covered in editing.spec).
 *
 * Two hard-won constraints for automating pragmatic-drag-and-drop:
 * - locator.dragTo() moves the pointer to the target in one step, so the
 *   dragstart coordinates land outside the handle and the library's
 *   elementFromPoint drag-handle check cancels the drag. The drag must
 *   start with a small move while still over the handle.
 * - Drag events are only delivered inside the viewport, so the drop
 *   target must be on-screen (hence the tall viewport).
 */
import { test, expect, type Page } from '@playwright/test'

test.use({ viewport: { width: 1280, height: 1600 } })

const email = `drag-${Date.now()}@example.com`

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Dragger')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill('DragProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'DragProj' }).click()
  await page.getByLabel('Lecture title').fill('DragDeck')
  await page.getByRole('button', { name: 'Start lecture' }).click()
  for (const phrase of ['Atomic structure', 'Protons, neutrons, electrons']) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    await expect(page.getByTestId('slide')).toBeVisible()
  }
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
}

test('slides reorder by dragging the handle with the pointer', async ({
  page,
}) => {
  await buildDeck(page)
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'title',
  )

  const handle = page.getByRole('button', { name: 'Reorder slide 1' })
  const target = page.getByTestId('slide').nth(1)
  const hb = (await handle.boundingBox())!
  const tb = (await target.boundingBox())!

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  // Small move first: dragstart must fire while still over the handle
  await page.mouse.move(hb.x + hb.width / 2 + 3, hb.y + hb.height / 2 + 3)
  await page.mouse.move(
    tb.x + tb.width / 2,
    tb.y + Math.min(tb.height / 2, 200),
    {
      steps: 15,
    },
  )
  await page.mouse.up()

  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
  await page.reload()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
})
