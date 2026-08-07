/**
 * Re-transcribing a slide from its recorded audio, end to end (GEN-4/EDIT-6):
 * a recorded lecture retains its audio, so the transcript editor offers
 * "Regenerate from spoken audio"; clicking it runs the server's speech engine
 * over that slide's audio and fills the field, and the result saves like any
 * other edit. Also covers the unsaved-changes guard on close.
 *
 * Runs only under the 'chromium-stt' project (mock STT server + fake audio +
 * audio retention), since a slide can only be re-transcribed from audio the
 * server actually kept.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
/** What the mock speech engine transcribes any audio to. */
const HEARD = 'Photosynthesis basics'

/** Opens the transcript editor from the first slide's kebab. */
const openEditor = async (page: Page) => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Edit spoken transcript' }).click()
  return page.getByRole('textbox', { name: 'Spoken transcript' })
}

test('regenerates a slide transcript from its recorded audio', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Speaker Two')
  await page.getByLabel('Email').fill(`regen-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Record a lecture: the fake mic feeds audio, the mock adapter returns its
  // scripted phrase, and a slide is generated from it.
  await createProject(page, 'Biology 202')
  await page
    .getByRole('button', { name: 'Start a new lecture in Biology 202' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis Basics' }),
  ).toBeVisible({ timeout: 15_000 })

  // Stopping the mic closes the socket, which flushes the session audio to
  // storage and attaches it to the lecture.
  await page.getByRole('button', { name: 'Live session' }).click()

  // The link appears once that audio is available for the slide (the viewer
  // polls for it; a reload is the deterministic path).
  await page.reload()
  let field = await openEditor(page)
  const regenerate = page.getByRole('button', {
    name: 'Regenerate from spoken audio',
  })
  await expect(regenerate).toBeVisible()

  // Rewrite it by hand. Closing now would lose that, so the editor asks first
  // — and the text stays when the discard is declined.
  await field.fill('A hand-typed rewrite.')
  await page.getByRole('button', { name: 'Cancel' }).first().click()
  const discard = page.getByRole('alertdialog', { name: 'Discard changes?' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(field).toHaveValue('A hand-typed rewrite.')

  await page.getByRole('button', { name: 'Save transcript' }).click()
  await expect(field).toBeHidden()
  await page.reload()
  field = await openEditor(page)
  await expect(field).toHaveValue('A hand-typed rewrite.')

  // Regenerating replaces the rewrite with what the engine hears in the slide's
  // recorded audio — in the field only, until it is saved.
  const regenerated = page.waitForResponse(
    r =>
      r.url().includes('/actions/slide.regenerateTranscript') &&
      r.status() === 200,
  )
  await page
    .getByRole('button', { name: 'Regenerate from spoken audio' })
    .click()
  expect((await (await regenerated).json()).transcript).toBe(HEARD)
  await expect(field).toHaveValue(HEARD)

  // And saving persists it, through a reload.
  await page.getByRole('button', { name: 'Save transcript' }).click()
  await expect(field).toBeHidden()
  await page.reload()
  field = await openEditor(page)
  await expect(field).toHaveValue(HEARD)
})
