/**
 * Two-layer seed notes end to end (PROJ-1/SEED-1): project notes
 * auto-save from the project page, lecture notes from the settings
 * modal, and both survive a reload.
 */
import { test, expect } from '@playwright/test'

const email = `seed-${Date.now()}@example.com`

test('project and lecture seed notes auto-save and persist', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Seeder')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Project-level notes save from the project page (blur flushes)
  await page.getByLabel('New project title').fill('SeedProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'SeedProj', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Project seed notes' })
    .fill('Course covers waves, optics, and thermodynamics')
  await page.getByRole('textbox', { name: 'Project seed notes' }).blur()

  await page.reload()
  await expect(
    page.getByRole('textbox', { name: 'Project seed notes' }),
  ).toHaveValue('Course covers waves, optics, and thermodynamics')

  // Lecture-level notes save from the settings modal
  await page.getByLabel('Lecture title').fill('Optics')
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page
    .getByRole('textbox', { name: 'Lecture seed notes' })
    .fill("Snell's law with the laser tank demo")
  await page.getByRole('textbox', { name: 'Lecture seed notes' }).blur()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Lecture seed notes' }),
  ).toHaveValue("Snell's law with the laser tank demo")
})
