/**
 * Whiteboard (WB-1/2/3) e2e: draw a pen stroke that persists across reload,
 * erase it as a timestamped event (kept in data, hidden in the edit view),
 * confirm drawing suppresses auto-slide-creation while the "+" button still
 * adds slides, that a spoken "resume" lifts the whiteboard generation pause,
 * and that deck playback runs with drawings present. Runs against the built
 * app + test MongoDB, like the other specs.
 */
import { test, expect, type Page } from './fixtures'
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

/** Drags the eraser along the same line a stroke was drawn on, so it crosses
 * the stroke rather than landing on a single point. A stationary press samples
 * one position and can miss the stroke entirely. */
const eraseAcrossSlide = async (page: Page, yFraction = 0.5) => {
  const box = await page.getByTestId('slide').boundingBox()
  if (!box) throw new Error('no slide box')
  const y = box.y + box.height * yFraction
  await page.mouse.move(box.x + box.width * 0.35, y)
  await page.mouse.down()
  // Swept rather than jumped. Erasing hit-tests each pointer position against
  // the stroke, so a drag of three points erases only where those three land:
  // a few pixels of layout shift between measuring the slide and moving the
  // mouse put all three off the stroke and nothing was erased. A real eraser
  // is dragged, and `steps` is what makes this one a drag.
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 12 })
  await page.mouse.move(box.x + box.width * 0.65, y, { steps: 12 })
  await page.mouse.up()
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
  const pen = page.getByRole('button', { name: 'Pen' })
  await pen.click()
  // Wait for the tool to actually be selected. Clicking only requests the
  // switch; dragging before it lands draws with the previous tool, so the
  // erase never happens and no save is ever stamped.
  await expect(pen).toHaveAttribute('aria-pressed', 'true')

  const saved = page.waitForResponse(r =>
    r.url().includes('/actions/slide.editDrawings'),
  )
  await drawOnSlide(page)
  await saved
  // The save having ANSWERED is not the same as the layer being able to erase
  // what was saved: erasing hit-tests against the strokes that come back as
  // props, and until those land the eraser passes over nothing. Waiting on
  // the response alone erased thin air under load, and the stamped save that
  // then never came was read as a flake.
  await expect(page.getByTestId('drawing-layer')).toHaveAttribute(
    'data-erasable',
    '1',
  )

  // Erase over the same stroke; it is stamped, not deleted. Wait for the save
  // that actually carries the stamp rather than whichever `editDrawings`
  // response arrives first — drawing and erasing both save, so matching on the
  // URL alone can capture the wrong one and read a pre-erase payload.
  const stamped = page.waitForResponse(async r => {
    if (!r.url().includes('/actions/slide.editDrawings')) return false
    try {
      const b = (await r.json()) as { drawings?: { erasedAnchor?: unknown }[] }
      return !!b.drawings?.some(d => d.erasedAnchor)
    } catch {
      return false
    }
  })
  const eraser = page.getByRole('button', { name: 'Eraser' })
  await eraser.click()
  await expect(eraser).toHaveAttribute('aria-pressed', 'true')
  await eraseAcrossSlide(page)
  const body = await (await stamped).json()
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

/** Speaks one phrase through the Speak bar and waits for it to fully settle.
 * Necessary when the next step types again: the form clears the input *after*
 * its request resolves, so filling mid-flight gets wiped and the submit is
 * silently dropped. Waiting for the empty input proves the reset has landed. */
const speakAndSettle = async (page: Page, phrase: string) => {
  const settled = page.waitForResponse(
    r => r.url().includes('/api/actions/session.phrase') && r.status() === 200,
  )
  await page.getByLabel('Spoken phrase').fill(phrase)
  await page.getByRole('button', { name: 'Speak' }).click()
  await settled
  await expect(page.getByLabel('Spoken phrase')).toHaveValue('')
}

test('a spoken "resume" lifts the whiteboard generation pause', async ({
  page,
}) => {
  await buildDeck(page)
  await expect(page.getByText('2 / 2')).toBeVisible()

  // A whiteboard slide pauses generation manually — it never auto-resumes, so
  // anything that lifts the pause here can only be the resume itself.
  await page.getByRole('button', { name: 'New whiteboard slide' }).click()
  await expect(page.getByText('3 / 3')).toBeVisible()
  await expect(
    page.getByText('Content generation paused for drawing'),
  ).toBeVisible()

  // While paused, speech is recorded but makes no slide — and stays paused.
  await speakAndSettle(page, 'Sketching the proof by hand')
  await expect(page.getByText('3 / 3')).toBeVisible()
  await expect(
    page.getByText('Content generation paused for drawing'),
  ).toBeVisible()

  // "Please resume" — no wake word, so the server's AI intent path (CAP-4)
  // recognizes it and the client runs the same resume the button does.
  await speakAndSettle(page, 'Please resume')
  await expect(page.getByText('Content generation resumed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)

  // Generation is genuinely back: the next phrase makes a slide, leaving the
  // whiteboard canvas itself untouched.
  await speakAndSettle(
    page,
    'A triangle has three interior angles summing to 180 degrees',
  )
  await expect(page.getByText('4 / 4')).toBeVisible()
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
