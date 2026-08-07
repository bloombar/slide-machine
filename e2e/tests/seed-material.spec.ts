/**
 * Seed material end to end (SEED-1/SEED-2): a photo uploads from the
 * project page, extraction settles to Ready, the caption saves, the
 * asset toggles out of generation, and deletion clears the list.
 */
import { test, expect } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const email = `material-${Date.now()}@example.com`

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('photo seed material uploads, captions, toggles, and deletes', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Curator')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'MaterialProj')
  await openProjectSettings(page, 'MaterialProj')

  // Upload a photo and watch extraction settle
  await page
    .getByLabel('Upload seed material')
    .setInputFiles({ name: 'golgi.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('golgi.png')).toBeVisible()
  await expect(page.getByText('Ready')).toBeVisible()

  // Caption it (flushes on blur) and reload to confirm persistence
  await page
    .getByLabel('Caption for golgi.png')
    .fill('Golgi apparatus micrograph')
  await page.getByLabel('Caption for golgi.png').blur()
  await page.waitForTimeout(200)
  await page.reload()
  await openProjectSettings(page, 'MaterialProj')
  await expect(page.getByLabel('Caption for golgi.png')).toHaveValue(
    'Golgi apparatus micrograph',
  )

  // Toggle it out of generation; the choice persists
  const toggle = page.getByRole('checkbox', {
    name: 'Use golgi.png in generation',
  })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await openProjectSettings(page, 'MaterialProj')
  await expect(
    page.getByRole('checkbox', { name: 'Use golgi.png in generation' }),
  ).not.toBeChecked()

  // Delete clears the list
  await page.getByRole('button', { name: 'Delete golgi.png' }).click()
  await expect(page.getByText('No seed material yet.')).toBeVisible()
})
