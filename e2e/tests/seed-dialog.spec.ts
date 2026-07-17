/**
 * Pre-lecture and mid-lecture seeding end to end (SEED-1/SEED-2): starting
 * a new lecture opens the seed dialog before recording; notes and uploads
 * made there land in the database and show up under Lecture settings; the
 * toolbar reopens the dialog during the lecture. Dismissing begins the
 * live session.
 */
import { test, expect } from '@playwright/test'

const email = `seeddialog-${Date.now()}@example.com`

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('seeding before and during a lecture, connected to settings', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Seeder')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill('SeedProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'SeedProj', exact: true }).click()

  // The + opens the lecture and the seed dialog BEFORE recording begins
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  const dialog = page.getByRole('dialog', { name: 'Add seed material' })
  await expect(dialog).toBeVisible()
  // Recording has not started yet
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'false')

  // Add notes and upload a photo from inside the dialog
  await dialog
    .getByRole('textbox', { name: 'Lecture seed notes' })
    .fill('Cell biology basics')
  await dialog
    .getByLabel('Upload seed material')
    .setInputFiles({ name: 'cell.png', mimeType: 'image/png', buffer: PNG })
  await expect(dialog.getByText('cell.png')).toBeVisible()

  // Start lecture: the dialog closes and recording begins
  await dialog.getByRole('button', { name: 'Start lecture' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Everything seeded shows up under Lecture settings — same data
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Lecture settings' })
  await expect(
    settings.getByRole('textbox', { name: 'Lecture seed notes' }),
  ).toHaveValue('Cell biology basics')
  await expect(settings.getByText('cell.png')).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // The toolbar reopens the dialog mid-lecture to add more material
  await page.getByRole('button', { name: 'Add seed material' }).click()
  const midDialog = page.getByRole('dialog', { name: 'Add seed material' })
  await expect(midDialog).toBeVisible()
  await midDialog.getByLabel('Upload seed material').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: PNG,
  })
  await expect(midDialog.getByText('notes.pdf')).toBeVisible()
  await midDialog.getByRole('button', { name: 'Done' }).click()
  await expect(midDialog).not.toBeVisible()

  // The mid-lecture upload also reached settings
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Lecture settings' })
      .getByText('notes.pdf'),
  ).toBeVisible()
})

test('skipping the seed dialog still starts the lecture', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Skipper')
  await page.getByLabel('Email').fill(`skip-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill('SkipProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'SkipProj', exact: true }).click()

  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add seed material' })
  await expect(dialog).toBeVisible()

  // Skip proceeds to recording, just without seeding
  await dialog.getByRole('button', { name: 'Skip' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'true')
})
