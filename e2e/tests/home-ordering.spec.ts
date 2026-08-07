/**
 * Home page orders projects by modification recency, where a modification
 * is EITHER a change to the project's own settings OR a change to any deck
 * inside it. Newly created projects sort by creation; a deck edit or a
 * project rename floats its project back to the top.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const email = `home-order-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

/** Titles of the project sub-headings, top to bottom, on the home page.
 * Scoped to "Your work": the Discover sidebar carries a heading of its own. */
const projectOrder = (page: import('@playwright/test').Page) =>
  page
    .getByRole('region', { name: 'Your work' })
    .getByRole('heading', { level: 2 })
    .allTextContents()

test('projects sort by most recent modification (settings or deck)', async ({
  page,
}) => {
  // Register and land on the home page
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Order Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Create Alpha, then Beta. Beta is created last, so it leads initially.
  for (const name of ['Alpha', 'Beta']) {
    await createProject(page, name)
    await page.goto('/app')
  }
  await expect.poll(() => projectOrder(page)).toEqual(['Beta', 'Alpha'])

  // Deck change: start a lecture inside Alpha (the older project). Creating
  // that deck is the newest modification, so Alpha jumps to the top.
  await page
    .getByRole('button', { name: 'Start a new lecture in Alpha' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.goto('/app')
  await expect.poll(() => projectOrder(page)).toEqual(['Alpha', 'Beta'])

  // Settings change: rename Beta on its project page. project.update bumps
  // Beta's own updatedAt, which is now the newest modification, so Beta leads.
  await page.getByRole('link', { name: 'Beta', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)
  await page.getByText('Beta', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Project title' }).fill('Beta Two')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Beta Two', exact: true }),
  ).toBeVisible()

  await page.goto('/app')
  await expect.poll(() => projectOrder(page)).toEqual(['Beta Two', 'Alpha'])
})
