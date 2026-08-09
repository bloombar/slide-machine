/**
 * The home screen's "+" menu beside the welcome heading: New project, New
 * lecture, and Import lecture. The lecture actions name no project, so they
 * land in the most recently modified one — checked here end to end against
 * the live front/back end and test DB.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

test('the "+" menu starts a lecture in the most recent project', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Menu Tester')
  await page.getByLabel('Email').fill(`home-menu-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Older first, so Recent is the most recently modified project
  await createProject(page, 'Older')
  await page.goto('/app')
  await createProject(page, 'Recent')
  await page.goto('/app')

  // The heading and the menu share the column that holds the projects;
  // Discover sits in the other one.
  const work = page.getByRole('region', { name: 'Your work' })
  await expect(work.getByRole('heading', { level: 1 })).toContainText('Welcome')

  await work.getByRole('button', { name: 'Create new' }).click()
  const menu = page.getByRole('menu', { name: 'Create new' })
  await expect(menu.getByRole('menuitem')).toHaveText([
    'New project',
    'New lecture',
    'Import a lecture',
  ])

  await menu.getByRole('menuitem', { name: 'New lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)

  // The lecture went into Recent, and shows up beneath it on home
  await page.goto('/app')
  const recent = page
    .getByRole('region', { name: 'Your work' })
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Recent' }) })
  await expect(recent.locator('a[href^="/d/"]')).toHaveCount(1)
})
