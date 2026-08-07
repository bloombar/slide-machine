/**
 * Deck export end to end (EXP-1/EXP-2/EXP-4): an instructor opens a lecture's
 * settings Export tab, downloads the deck as a PDF, and saves it to Google
 * Slides in a Drive folder they create. The Google side is mock-backed
 * (EXPORT_MODE defaults to mock), so the full flow runs with the live
 * front/back end and test DB; the PDF download is produced for real.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

test('export a lecture to PDF download and Google Slides in Drive', async ({
  page,
}) => {
  // A lecture with one slide to export
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Exporter')
  await page.getByLabel('Email').fill(`export-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'ExportProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in ExportProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Photosynthesis happens in the chloroplasts')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Open the Export tab in lecture settings
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Export' }).click()

  // Download a PDF (produced for real by the server)
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)

  // Switch to Google Slides — it is Drive-only, so connect Google first
  await dialog.getByRole('radio', { name: /Google Slides/ }).check()
  await expect(
    dialog.getByText(/always saved to your Google Drive/i),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Connect Google' }).click()
  await dialog
    .getByRole('button', { name: 'Save Google Slides to Drive' })
    .click()

  // Create a destination folder in the picker, then save into it
  const picker = page.getByRole('dialog', { name: 'Choose a Drive folder' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'New folder' }).click()
  await picker.getByLabel('New folder name').fill('E2E Exports')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(
    picker.getByRole('button', { name: 'E2E Exports' }),
  ).toBeVisible()
  await picker.getByRole('button', { name: 'Save here' }).click()

  // The resulting Google Slides link appears (in the confirmation and the
  // "Saved to Drive" list), and the confirmation names the destination folder.
  await expect(
    dialog.locator('a[href*="docs.google.com/presentation"]').first(),
  ).toBeVisible()
  await expect(dialog.getByText(/Saved to E2E Exports/)).toBeVisible()
  // The saved export is listed and can be deleted.
  await expect(dialog.getByText('Saved to Drive')).toBeVisible()
})

test('export a design to Google Slides in Drive (EXP-6)', async ({ page }) => {
  // A template in Google Slides is just a presentation whose layouts define a
  // design, so exporting one has to produce exactly that — and only a live
  // browser can say the whole flow reaches Drive.
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Designer')
  await page.getByLabel('Email').fill(`design-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'DesignProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in DesignProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Design' }).click()

  // Drive-only, so it needs a connected account first — the Export tab is
  // where connecting lives.
  await dialog.getByRole('tab', { name: 'Export' }).click()
  await dialog.getByRole('radio', { name: /Google Slides/ }).check()
  await dialog.getByRole('button', { name: 'Connect Google' }).click()
  await dialog.getByRole('tab', { name: 'Design' }).click()

  await dialog
    .getByRole('button', { name: 'Export design to Google Slides' })
    .click()

  const picker = page.getByRole('dialog', { name: 'Choose a Drive folder' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'New folder' }).click()
  await picker.getByLabel('New folder name').fill('E2E Designs')
  await picker.getByRole('button', { name: 'Create' }).click()
  await picker.getByRole('button', { name: 'Save here' }).click()

  // The design is in Drive, and opens in Slides rather than as a file
  const link = dialog.locator('a[href*="docs.google.com/presentation"]').first()
  await expect(link).toBeVisible()
  await expect(link).toHaveText(/open in google slides/i)
})
