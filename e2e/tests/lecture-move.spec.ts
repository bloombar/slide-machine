/**
 * Moving a lecture between projects end to end (PROJ-3): the Project
 * control in Lecture settings offers the projects the user owns, and
 * picking one refiles the lecture — the viewer's breadcrumb, and both
 * project pages, agree about where it now lives.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const email = `move-${Date.now()}@example.com`

const goHome = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
}

test('a lecture moves from one project to another', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Mover')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Two projects, and a lecture that starts in the first
  await createProject(page, 'MoveFrom')
  await goHome(page)
  await createProject(page, 'MoveTo')
  await goHome(page)
  await page.getByRole('link', { name: 'MoveFrom', exact: true }).click()
  await page
    .getByRole('button', { name: 'Start a new lecture in MoveFrom' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // The viewer's breadcrumb says where it lives now
  await expect(
    page.getByRole('link', { name: 'MoveFrom', exact: true }),
  ).toBeVisible()

  // Move it from the lecture's own settings
  await goHome(page)
  await page
    .getByRole('button', { name: 'Options for Untitled lecture' })
    .click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Lecture settings' })
  await expect(settings).toBeVisible()
  const projectSelect = settings.getByRole('combobox', { name: 'Project' })
  // Both of this user's projects are offered, on the one it is in
  await expect(projectSelect).toHaveValue(/.+/)
  await expect(projectSelect.locator('option')).toHaveText([
    'MoveFrom',
    'MoveTo',
  ])
  await projectSelect.selectOption({ label: 'MoveTo' })

  // The viewer reloads onto the new project
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(
    page.getByRole('link', { name: 'MoveTo', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'MoveFrom', exact: true }),
  ).toHaveCount(0)

  // And both project pages agree
  await goHome(page)
  await page.getByRole('link', { name: 'MoveTo', exact: true }).click()
  await expect(page.getByText('Untitled lecture')).toBeVisible()
  await goHome(page)
  await page.getByRole('link', { name: 'MoveFrom', exact: true }).click()
  await expect(page.getByText('Untitled lecture')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Start a new lecture in MoveFrom' }),
  ).toBeVisible()
})
