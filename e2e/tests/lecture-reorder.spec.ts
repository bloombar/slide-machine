/**
 * Ordering a project's lectures by dragging, end to end (PROJ-4).
 *
 * A lecture row is a link end to end (the title is the click target for
 * the whole row width) plus a kebab button, unlike a slide row — there is
 * no non-interactive stretch of the row itself to grab, so LectureRow
 * renders its own grip (`data-drag-handle`, DraggableListRow's
 * `handleOnly` mode) and the pointer drag below starts from that. The
 * keyboard path (Alt+ArrowUp/Down) is asserted too, since it is a real
 * path of its own — drag-reorder.spec covers it for slides — but the
 * pointer drag is what proves the SPEC's own word, "drag". It runs
 * against the live front/back end and test DB, and checks the order
 * survives a reload and reaches the home page — the two places the SPEC
 * says must agree.
 *
 * Two hard-won constraints for automating pragmatic-drag-and-drop (see
 * drag-reorder.spec for slides): the drag must start with a small move
 * while still over the source, or the library's elementFromPoint check
 * cancels it; and drag events are only delivered inside the viewport, so
 * the drop target must be on-screen (hence the tall viewport).
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

test.use({ viewport: { width: 1280, height: 1600 } })

const email = `reorder-${Date.now()}@example.com`

/** Renames the lecture the viewer is open on, through its in-place title. */
const renameLecture = async (page: Page, title: string) => {
  await page.getByTitle('Click to edit Lecture title').click()
  const box = page.getByRole('textbox', { name: 'Lecture title' })
  await box.fill(title)
  await box.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title)
}

/** Starts a lecture from the project page and gives it `title`, landing back
 * on the project page. */
const addLecture = async (
  page: Page,
  projectUrl: string,
  projectTitle: string,
  title: string,
) => {
  await page
    .getByRole('button', { name: `Start a new lecture in ${projectTitle}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  // The pre-lecture seed dialog opens first; dismiss it
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await renameLecture(page, title)
  await page.goto(projectUrl)
}

test('an owner drags lectures into a chosen order, which survives a reload and reaches the home page', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Reorderer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'OrderProj')
  const projectUrl = page.url()

  // Newest-first by default: Intro first, Review second — Review lands
  // first once it is created.
  await addLecture(page, projectUrl, 'OrderProj', 'Intro')
  await addLecture(page, projectUrl, 'OrderProj', 'Review')

  // This project's own lectures. Home names lectures in two places (its own
  // projects and Discover beside them), so scope to the named landmark.
  const lectures = page.getByRole('region', { name: 'Lectures' })
  const rowOrder = () =>
    lectures
      .locator('li[aria-label]')
      .evaluateAll(els => els.map(el => el.getAttribute('aria-label')))

  await expect(lectures).toBeVisible()
  await expect.poll(rowOrder).toEqual(['Review', 'Intro'])

  // Keyboard path: focus "Intro" and move it up past "Review". A real path
  // of its own — DraggableListRow's Alt+Arrow handler, unaffected by the
  // pointer drag surface being narrowed to the grip below. Each move is an
  // optimistic update that saves in the background (applyOrder, like
  // DeckViewerPage's own slide reorder), so this waits for the save to
  // land before firing the next one — two reorders of the SAME project
  // racing the same document is a real way to lose one, not a synthetic
  // problem the wait is inventing.
  const reordered = () =>
    page.waitForResponse(res =>
      res.url().includes('/api/actions/project.reorderLectures'),
    )
  await lectures.getByRole('listitem', { name: 'Intro' }).focus()
  await Promise.all([reordered(), page.keyboard.press('Alt+ArrowUp')])
  await expect.poll(rowOrder).toEqual(['Intro', 'Review'])
  // Move it back, so the pointer drag below is what actually sets the
  // order this test persists and checks.
  await Promise.all([reordered(), page.keyboard.press('Alt+ArrowDown')])
  await expect.poll(rowOrder).toEqual(['Review', 'Intro'])

  // Pointer path: drag "Intro"'s grip up onto the "Review" row. Synthetic
  // drags can be dropped under CPU contention (parallel workers); retry
  // the gesture — the assertion below stays strict. Each attempt waits for
  // its own save to land before deciding whether to retry, for the same
  // reason the keyboard moves above do.
  for (let attempt = 0; attempt < 3; attempt++) {
    const grip = lectures.getByRole('button', {
      name: 'Drag to reorder Intro',
    })
    const target = lectures.getByRole('listitem', { name: 'Review' })
    const gb = (await grip.boundingBox())!
    const tb = (await target.boundingBox())!

    const response = reordered()
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    // Small move first: dragstart must fire while still over the grip
    await page.mouse.move(gb.x + gb.width / 2 + 3, gb.y + gb.height / 2 + 3)
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, {
      steps: 15,
    })
    await page.mouse.up()

    if ((await rowOrder()).join() === ['Intro', 'Review'].join()) {
      // The drop landed; still wait for its save so nothing overlaps with
      // what comes next.
      await response
      break
    }
    // No drop registered from this attempt (CPU contention) — do not wait
    // on a response that may never arrive.
    response.catch(() => {})
  }
  await expect.poll(rowOrder).toEqual(['Intro', 'Review'])

  // Persists: a reload re-fetches from the server rather than replaying
  // local state.
  await page.reload()
  await expect.poll(rowOrder).toEqual(['Intro', 'Review'])

  // The same order reaches the home page (deck.list with no projectId,
  // grouped by project) — the requirement most likely to be missed.
  await page.goto('/app')
  const introLink = page.getByRole('link', { name: /^Intro/ })
  const reviewLink = page.getByRole('link', { name: /^Review/ })
  await expect(introLink).toBeVisible()
  await expect(reviewLink).toBeVisible()
  const introBox = (await introLink.boundingBox())!
  const reviewBox = (await reviewLink.boundingBox())!
  expect(introBox.y).toBeLessThan(reviewBox.y)
})
