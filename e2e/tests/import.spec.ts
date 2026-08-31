/**
 * Deck round-trip import end to end (EXP-3): an instructor exports a lecture to
 * YAML from the Export tab, then imports that same file back into the project
 * from the "+" menu on the Lectures row, and a second lecture appears. Runs against the
 * live front/back end and test DB; the export is produced for real.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

test('round-trip: export a lecture to YAML and re-import it', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Importer')
  await page.getByLabel('Email').fill(`import-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'ImportProj')
  const projectUrl = page.url()

  // A lecture with one slide to export
  await page
    .getByRole('button', { name: 'Start a new lecture in ImportProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Photosynthesis happens in the chloroplasts')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Export the deck as YAML and capture the downloaded file
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Export' }).click()
  await dialog.getByRole('radio', { name: /YAML/ }).check()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download YAML' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.yaml$/)
  const filePath = await download.path()

  // Back on the project page there is exactly one lecture so far
  await page.goto(projectUrl)
  await expect(page.getByRole('heading', { name: 'Lectures' })).toBeVisible()
  const lectureLinks = page.locator('a[href^="/d/"]')
  await expect(lectureLinks).toHaveCount(1)

  // Import the exported file from the "+" menu on the Lectures row. The menu
  // has one import entry whatever the material is; it opens the panel that
  // asks where the lecture is coming from, and the file is picked there.
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Import a lecture' }).click()
  await page.getByLabel(/import a lecture file/i).setInputFiles(filePath)

  // A confirmation notice, a second lecture, and the panel gone: a finished
  // import does not leave a box open over the list it just added to.
  await expect(page.getByText(/^Imported /)).toBeVisible()
  await expect(lectureLinks).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Choose a presentation' }),
  ).toBeHidden()
})
