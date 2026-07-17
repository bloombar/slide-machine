/**
 * The carousel/list view choice persists across a reload, so refreshing
 * keeps whichever view the user was reading in.
 */
import { test, expect } from '@playwright/test'

test('the view mode is remembered across a refresh', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Viewer')
  await page.getByLabel('Email').fill(`viewmode-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill('ViewProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'ViewProj', exact: true }).click()

  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Atomic structure')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Switch to list view — carousel is the default
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // A refresh must keep list view, not fall back to carousel
  await page.reload()
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
