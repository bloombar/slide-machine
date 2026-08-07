/**
 * The home-page project kebab: Settings and Share deep-link into the
 * project settings modal on the right tab, and Delete removes the project
 * after confirmation.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const email = `project-menu-${Date.now()}@example.com`

test('project kebab deep-links to settings tabs and deletes', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Menu Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, 'KebabProj')
  await page.goto('/app')

  // Share opens the project settings on the Privacy & Sharing tab
  await page.getByRole('button', { name: 'Options for KebabProj' }).click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)
  await expect(
    page.getByRole('dialog', { name: 'Project settings' }),
  ).toBeVisible()
  await expect(
    page.getByRole('tab', { name: 'Privacy & Sharing' }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Settings opens the same modal on the General tab
  await page.goto('/app')
  await page.getByRole('button', { name: 'Options for KebabProj' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Project settings' }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Delete removes the project from the home list after confirming
  await page.goto('/app')
  await page.getByRole('button', { name: 'Options for KebabProj' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete project?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()

  await expect(page.getByRole('heading', { name: 'KebabProj' })).toHaveCount(0)
  // With no projects left, the empty-state New lecture zone takes over
  await expect(
    page.getByRole('button', { name: 'Start a new lecture', exact: true }),
  ).toBeVisible()
})
