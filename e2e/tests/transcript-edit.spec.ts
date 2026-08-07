/**
 * EDIT-6 e2e: the slide kebab opens the spoken-transcript editor, the edit
 * persists across a reload, and Cancel discards. Also checks that a slide
 * carrying whiteboard marks keeps them through a transcript edit (WB-2
 * re-anchoring), since the marks are timed by position in that very text.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'

const PHRASE = 'Mitochondria produce energy for the cell'

/**
 * Registers a fresh user (the specs run in parallel, so each needs its own
 * account and project) and dictates one phrase, yielding a one-slide lecture.
 */
const buildDeck = async (page: Page, who: string) => {
  const project = `Cell Biology ${who}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Narrator')
  await page
    .getByLabel('Email')
    .fill(`transcript-${who}-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  // The pre-lecture seed dialog opens first; dismiss it to begin recording
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByLabel('Spoken phrase').fill(PHRASE)
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
}

/** Opens the transcript editor from the first slide's kebab. */
const openEditor = async (page: Page) => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Edit spoken transcript' }).click()
  return page.getByRole('textbox', { name: 'Spoken transcript' })
}

test('edits a slide transcript from the kebab, and cancels without saving', async ({
  page,
}) => {
  await buildDeck(page, 'edit')

  // The dialog opens on what was actually said
  let field = await openEditor(page)
  await expect(field).toHaveValue(PHRASE)

  // Cancel discards the edit — after confirming, since it is unsaved work
  await field.fill('Discarded rewrite')
  await page.getByRole('button', { name: 'Cancel' }).first().click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(field).toBeHidden()
  field = await openEditor(page)
  await expect(field).toHaveValue(PHRASE)

  // Save persists it, through a reload
  await field.fill('Mitochondria are the cell’s power plants.')
  await page.getByRole('button', { name: 'Save transcript' }).click()
  await expect(field).toBeHidden()

  await page.reload()
  field = await openEditor(page)
  await expect(field).toHaveValue('Mitochondria are the cell’s power plants.')
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('previews the edited transcript aloud before saving', async ({ page }) => {
  await buildDeck(page, 'preview')
  const field = await openEditor(page)

  // The preview speaks the FIELD, so it synthesizes the unsaved text.
  await field.fill('A rewrite, heard before it is saved.')
  const spoken = page.waitForResponse(
    r => r.url().includes('/tts') && r.status() === 200,
  )
  await page.getByRole('button', { name: 'Play the spoken transcript' }).click()
  expect((await (await spoken).request().postDataJSON()).text).toBe(
    'A rewrite, heard before it is saved.',
  )

  // Playing flips the control to Pause…
  const pause = page.getByRole('button', {
    name: 'Pause the spoken transcript',
  })
  await expect(pause).toBeVisible()
  await pause.click()
  await expect(
    page.getByRole('button', { name: 'Play the spoken transcript' }),
  ).toBeVisible()

  // …and editing the text stops the preview of the words it replaced.
  await page.getByRole('button', { name: 'Play the spoken transcript' }).click()
  await expect(pause).toBeVisible()
  await field.fill('Different words entirely.')
  await expect(
    page.getByRole('button', { name: 'Play the spoken transcript' }),
  ).toBeVisible()
})

test('refines the transcript into the field, saving only on request', async ({
  page,
}) => {
  await buildDeck(page, 'refine')
  const field = await openEditor(page)
  await expect(field).toHaveValue(PHRASE)

  // Refine runs the narration pass and shows the result for review; the mock
  // generator marks each pass, so the rewrite is visible.
  const refined = page.waitForResponse(
    r =>
      r.url().includes('/actions/deck.refineSlideTranscript') &&
      r.status() === 200,
  )
  await page.getByRole('button', { name: 'Refine with AI' }).click()
  expect((await (await refined).json()).transcript).toBe(`${PHRASE} (refined)`)
  await expect(field).toHaveValue(`${PHRASE} (refined)`)

  // Nothing is stored yet: discarding leaves the original narration in place.
  await page.getByRole('button', { name: 'Cancel' }).first().click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await page.reload()
  await expect(await openEditor(page)).toHaveValue(PHRASE)

  // Refining again and saving does persist it.
  await page.getByRole('button', { name: 'Refine with AI' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Spoken transcript' }),
  ).toHaveValue(`${PHRASE} (refined)`)
  await page.getByRole('button', { name: 'Save transcript' }).click()
  await page.reload()
  await expect(await openEditor(page)).toHaveValue(`${PHRASE} (refined)`)
})

test('keeps whiteboard marks on a slide whose transcript is rewritten', async ({
  page,
}) => {
  const REWRITE = 'Mitochondria produce the energy a cell runs on.'
  await buildDeck(page, 'marks')

  // Draw one pen stroke across the slide and let it save
  await expect(page.getByTestId('whiteboard-toolbar')).toBeVisible()
  await page.getByRole('button', { name: 'Pen' }).click()
  const drawn = page.waitForResponse(
    r => r.url().includes('/actions/slide.editDrawings') && r.status() === 200,
  )
  const box = (await page.getByTestId('slide').boundingBox())!
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.3, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, y)
  await page.mouse.move(box.x + box.width * 0.6, y)
  await page.mouse.up()
  expect((await (await drawn).json()).drawings).toHaveLength(1)

  // The editor says the slide's marks are timed to this text
  const markNotice = page.getByText(
    /whiteboard markings timed to the transcript/i,
  )
  const field = await openEditor(page)
  await expect(markNotice).toBeVisible()

  // Rewriting the narration keeps the mark — re-anchored, not dropped
  const saved = page.waitForResponse(
    r =>
      r.url().includes('/actions/slide.editTranscript') && r.status() === 200,
  )
  await field.fill(REWRITE)
  await page.getByRole('button', { name: 'Save transcript' }).click()
  const slide = await (await saved).json()
  expect(slide.sourceTranscript).toBe(REWRITE)
  expect(slide.drawings).toHaveLength(1)
  // Re-anchored within the new text, not left pointing past its end
  expect(slide.drawings[0].anchor.charAnchor).toBeLessThanOrEqual(
    REWRITE.length,
  )

  // Both survive a reload
  await page.reload()
  await expect(await openEditor(page)).toHaveValue(REWRITE)
  await expect(markNotice).toBeVisible()
})
