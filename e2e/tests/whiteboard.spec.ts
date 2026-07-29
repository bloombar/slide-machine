/**
 * Whiteboard (WB-1/2/3) e2e: draw a pen stroke that persists across reload,
 * erase it as a timestamped event (kept in data, hidden in the edit view),
 * confirm drawing suppresses auto-slide-creation while the "+" button still
 * adds slides, and that deck playback runs with drawings present. Runs against
 * the built app + test MongoDB, like the other specs.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
let seq = 0

/** Registers, opens a fresh lecture, and adds two slides via the Speak bar.
 * Each call mints a unique account so the tests stay independent. */
const buildDeck = async (page: Page) => {
  const email = `wb-${Date.now()}-${seq++}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Artist')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Geometry')
  await page
    .getByRole('button', { name: 'Start a new lecture in Geometry' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  const phrases = ['Lines and points', 'Angles and triangles']
  for (const [i, phrase] of phrases.entries()) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    // Wait for THIS phrase's slide before speaking the next: a slide element
    // is on screen the whole time, so waiting on it settles nothing and the
    // deck can still be mid-build when the calling test starts.
    await expect(page.getByText(`${i + 1} / ${i + 1}`)).toBeVisible()
  }
}

/** Drags the mouse across the current slide to draw a stroke, at an optional
 * vertical fraction of the slide so successive strokes stay distinct. */
const drawOnSlide = async (page: Page, yFraction = 0.5) => {
  const box = await page.getByTestId('slide').boundingBox()
  if (!box) throw new Error('no slide box')
  const y = box.y + box.height * yFraction
  await page.mouse.move(box.x + box.width * 0.3, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, y)
  await page.mouse.move(box.x + box.width * 0.6, y)
  await page.mouse.up()
}

test('draws a stroke that survives reload', async ({ page }) => {
  await buildDeck(page)

  // Select the pen from the whiteboard toolbar, then draw.
  await expect(page.getByTestId('whiteboard-toolbar')).toBeVisible()
  await page.getByRole('button', { name: 'Pen' }).click()

  const saved = page.waitForResponse(
    r => r.url().includes('/actions/slide.editDrawings') && r.status() === 200,
  )
  await drawOnSlide(page)
  const savedBody = await (await saved).json()
  expect(savedBody.drawings.length).toBeGreaterThan(0)
  const drawnSlideId = savedBody.id

  // Reload; the deck view must come back with the stroke on that slide.
  const reloaded = page.waitForResponse(
    r => /\/api\/decks\//.test(r.url()) && r.status() === 200,
  )
  await page.reload()
  const view = await (await reloaded).json()
  const slide = view.slides.find((s: { id: string }) => s.id === drawnSlideId)
  expect(slide.drawings.length).toBeGreaterThan(0)
  expect(slide.drawings[0].tool).toBe('pen')
})

test('erases a stroke as a timestamped event (kept in data)', async ({
  page,
}) => {
  await buildDeck(page)
  await page.getByRole('button', { name: 'Pen' }).click()

  let saved = page.waitForResponse(r =>
    r.url().includes('/actions/slide.editDrawings'),
  )
  await drawOnSlide(page)
  await saved

  // Erase over the same stroke; it is stamped, not deleted.
  await page.getByRole('button', { name: 'Eraser' }).click()
  saved = page.waitForResponse(r =>
    r.url().includes('/actions/slide.editDrawings'),
  )
  const box = await page.getByTestId('slide').boundingBox()
  if (!box) throw new Error('no slide box')
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  const body = await (await saved).json()
  expect(body.drawings).toHaveLength(1)
  expect(body.drawings[0].erasedAnchor).toBeTruthy() // kept + stamped
})

test('active drawing suppresses auto-slide-creation; idle tool and "+" still add', async ({
  page,
}) => {
  await buildDeck(page)
  // Adding slides navigates to the last one, so the counter reads 2 / 2.
  await expect(page.getByText('2 / 2')).toBeVisible()

  // Selecting a tool WITHOUT drawing does not suppress — a phrase still adds.
  await page.getByRole('button', { name: 'Pen' }).click()
  await page.getByLabel('Spoken phrase').fill('A separate new topic')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('3 / 3')).toBeVisible()

  // Actively drawing suppresses the next phrase (it folds into the slide).
  await drawOnSlide(page)
  await page.getByLabel('Spoken phrase').fill('An aside while I annotate')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('3 / 3')).toBeVisible() // still three slides

  // The explicit "+" button bypasses suppression and adds a slide.
  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByText('4 / 4')).toBeVisible()
})

test('drawings are not lost when a mic phrase updates the slide mid-draw', async ({
  page,
}) => {
  await buildDeck(page)
  await page.getByRole('button', { name: 'Pen' }).click()

  // Draw a first stroke, then immediately submit a phrase BEFORE the debounced
  // drawing save lands — so the session.phrase response carries no drawings.
  // Its update must not clobber the in-progress local strokes.
  const phrased = page.waitForResponse(
    r => r.url().includes('/actions/session.phrase') && r.status() === 200,
  )
  await drawOnSlide(page, 0.35)
  await page.getByLabel('Spoken phrase').fill('More detail about this slide')
  await page.getByRole('button', { name: 'Speak' }).click()
  // Wait for the phrase to actually land before checking the count: the deck
  // already reads 2 / 2 here, so asserting it unawaited would pass even if the
  // phrase went on to add a third slide.
  await phrased
  await expect(page.getByText('2 / 2')).toBeVisible() // folded in, no new slide

  // Draw a second stroke; the save must contain BOTH, not just the second.
  // Match on the save that actually carries two strokes rather than the next
  // save of any kind: the first stroke's own debounced save is still pending
  // here, and on a slow machine it lands mid-way through drawing the second.
  // Waiting for that one would let the reload below cancel the second stroke's
  // debounce, losing it — a race in the test, not in the app.
  const saved = page.waitForResponse(r => {
    if (!r.url().includes('/actions/slide.editDrawings') || r.status() !== 200)
      return false
    const sent = JSON.parse(r.request().postData() ?? '{}')
    return (sent.drawings?.length ?? 0) === 2
  })
  await drawOnSlide(page, 0.65)
  await saved

  const reloaded = page.waitForResponse(
    r => /\/api\/decks\//.test(r.url()) && r.status() === 200,
  )
  await page.reload()
  const view = await (await reloaded).json()
  // Both strokes survive on the slide that was drawn on (the current one).
  expect(view.slides[1].drawings).toHaveLength(2)
})

test('deck playback returns TTS marks for stroke sync (WB-2)', async ({
  page,
}) => {
  await buildDeck(page)
  await page.getByRole('button', { name: 'Pen' }).click()
  const saved = page.waitForResponse(r =>
    r.url().includes('/actions/slide.editDrawings'),
  )
  await drawOnSlide(page)
  await saved

  // Playing the deck synthesizes each slide; the response must now include the
  // `marks` timepoint array the client resolves stroke reveal times against.
  const ttsResponse = page.waitForResponse(
    r => /\/api\/slides\/.+\/tts$/.test(r.url()) && r.status() === 200,
  )
  await page.getByRole('button', { name: 'Play deck' }).click()
  const body = await (await ttsResponse).json()
  expect(Array.isArray(body.marks)).toBe(true)
  expect(body).toHaveProperty('url')
})

test('opening a slide kebab while drawing exits drawing mode', async ({
  page,
}) => {
  await buildDeck(page)
  await page.getByRole('button', { name: 'Pen' }).click()
  await expect(page.getByRole('button', { name: 'Pen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // The kebab stays clickable above the drawing canvas, and opening it drops
  // the active tool back to normal mode.
  await page.getByRole('button', { name: /Options for slide/ }).click()
  await expect(page.getByRole('button', { name: 'Pen' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
