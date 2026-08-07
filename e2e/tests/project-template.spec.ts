/**
 * Project default template end to end (TMPL-2): new lectures start from
 * the project's template; each lecture keeps its own stored template,
 * so later project changes never rewrite existing lectures.
 */
import { test, expect } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const email = `ptmpl-${Date.now()}@example.com`

test('project template is the default for new lectures only', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Templater')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'TmplProj')

  // Default the project to Midnight
  await openProjectSettings(page, 'TmplProj')
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('radio', { name: /midnight/i }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // A new lecture starts on Midnight
  await page
    .getByRole('button', { name: 'Start a new lecture in TmplProj' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  // Dismiss the pre-lecture seed dialog before reaching settings
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // The lecture switches itself to Seminar; a later project change
  // back to Classic must not touch it
  await page.getByRole('radio', { name: /seminar/i }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'TmplProj', exact: true }).click()
  await openProjectSettings(page, 'TmplProj')
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('radio', { name: /classic/i }).click()
  await expect(page.getByRole('radio', { name: /classic/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('link', { name: /Untitled lecture/ }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
