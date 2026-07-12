/**
 * Project default template end to end (TMPL-2): new lectures start from
 * the project's template; each lecture keeps its own stored template,
 * so later project changes never rewrite existing lectures.
 */
import { test, expect } from '@playwright/test'

const email = `ptmpl-${Date.now()}@example.com`

test('project template is the default for new lectures only', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Templater')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByLabel('New project title').fill('TmplProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'TmplProj', exact: true }).click()

  // Default the project to Midnight
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('tab', { name: 'Design template' }).click()
  await page.getByRole('radio', { name: /midnight/i }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // A new lecture starts on Midnight
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design template' }).click()
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

  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await page.getByRole('link', { name: 'TmplProj', exact: true }).click()
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('tab', { name: 'Design template' }).click()
  await page.getByRole('radio', { name: /classic/i }).click()
  await expect(page.getByRole('radio', { name: /classic/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('link', { name: /Untitled lecture/ }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design template' }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
