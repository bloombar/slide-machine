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

  // Project-level notes save from the project settings modal (blur flushes)
  await page.getByLabel('New project title').fill('SeedProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'SeedProj', exact: true }).click()
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page
    .getByRole('textbox', { name: 'Project seed notes' })
    .fill('Course covers waves, optics, and thermodynamics')
  await page.getByRole('textbox', { name: 'Project seed notes' }).blur()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.reload()
  await page.getByRole('button', { name: 'Project settings' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Project seed notes' }),
  ).toHaveValue('Course covers waves, optics, and thermodynamics')
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Lecture-level notes save from the lecture settings modal
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
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

  // AI freedom: the lecture inherits until its slider moves, then keeps
  // its own value across reloads
  const slider = page.getByRole('slider', { name: 'AI freedom' })
  await expect(slider).toHaveValue('3')
  await expect(page.getByText(/using the project setting/i)).toBeVisible()
  await slider.fill('8')
  await expect(page.getByText(/set at this level/i)).toBeVisible()
  await page.waitForTimeout(700)
  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(page.getByRole('slider', { name: 'AI freedom' })).toHaveValue(
    '8',
  )

  // Re-inheriting drops back to the project setting
  await page.getByRole('button', { name: 'Use project setting' }).click()
  await expect(page.getByText(/using the project setting/i)).toBeVisible()
})
