/**
 * Regression: pointer-based drag reordering (the keyboard path is
 * covered in editing.spec).
 *
 * Two hard-won constraints for automating pragmatic-drag-and-drop:
 * - locator.dragTo() moves the pointer to the target in one step, so the
 *   dragstart coordinates land outside the source row and the library's
 *   elementFromPoint check cancels the drag. The drag must start with a
 *   small move while still over the source.
 * - Drag events are only delivered inside the viewport, so the drop
 *   target must be on-screen (hence the tall viewport).
 *
 * The whole row is the drag surface, but drags must start from a
 * non-interactive spot — the slide's padding corner, not the editable
 * text (which is reserved for click-to-edit).
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

test.use({ viewport: { width: 1280, height: 1600 } })

const email = `drag-${Date.now()}@example.com`

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Dragger')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'DragProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in DragProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  // The pre-lecture seed dialog opens first; dismiss it to begin recording
  await page.getByRole('button', { name: 'Start lecture' }).click()
  for (const phrase of ['Atomic structure', 'Protons, neutrons, electrons']) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    await expect(page.getByTestId('slide')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Live session' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
}

test('slides reorder by dragging anywhere on the slide', async ({ page }) => {
  await buildDeck(page)
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'title',
  )

  // Synthetic drags can be dropped under CPU contention (parallel
  // workers); retry the gesture — the assertions below stay strict
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = page.getByRole('listitem', { name: 'Slide 1' })
    const target = page.getByTestId('slide').nth(1)
    const sb = (await source.boundingBox())!
    const tb = (await target.boundingBox())!

    // Grab the slide's top-left padding, away from editable text and
    // the top-right delete button
    await page.mouse.move(sb.x + 15, sb.y + 15)
    await page.mouse.down()
    // Small move first: dragstart must fire while still over the source
    await page.mouse.move(sb.x + 18, sb.y + 18)
    await page.mouse.move(
      tb.x + tb.width / 2,
      tb.y + Math.min(tb.height / 2, 200),
      {
        steps: 15,
      },
    )
    await page.mouse.up()

    const layout = await page
      .getByTestId('slide')
      .first()
      .getAttribute('data-layout')
    if (layout === 'list') break
  }

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
