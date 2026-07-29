/**
 * Deck round-trip import end to end (EXP-3): an instructor exports a lecture to
 * YAML from the Export tab, then imports that same file back into the project
 * from the "Import" affordance, and a second lecture appears. Runs against the
 * live front/back end and test DB; the export is produced for real.
 */
import { test, expect } from '@playwright/test'
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

  // Import the exported file → a confirmation notice and a second lecture
  await page.locator('input[type="file"]').setInputFiles(filePath)
  await expect(page.getByText(/^Imported /)).toBeVisible()
  await expect(lectureLinks).toHaveCount(2)
})
