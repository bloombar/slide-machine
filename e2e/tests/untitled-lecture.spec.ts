/**
 * Untitled lectures end to end: the per-project + option on the home
 * screen leads to the start form, Start lecture works with no title,
 * the interface shows "Untitled lecture" everywhere while the data
 * keeps an empty title, and naming it later works in place.
 */
import { test, expect } from '@playwright/test'

const email = `untitled-${Date.now()}@example.com`

test('untitled lectures start from the + option and can be named later', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Untitler')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByLabel('New project title').fill('QuickStart')
  await page.getByRole('button', { name: 'Create' }).click()

  // The + beside the project heading leads to the start-lecture form
  await page
    .getByRole('link', { name: 'Start a new lecture in QuickStart' })
    .click()
  await expect(page).toHaveURL(/\/app\/projects\//)

  // No title typed: Start lecture works anyway
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await expect(
    page.getByRole('heading', { name: 'Untitled lecture' }),
  ).toBeVisible()

  // Home lists it as Untitled lecture too
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await expect(
    page.getByRole('link', { name: /Untitled lecture/ }),
  ).toBeVisible()

  // Name it later in place from the nav
  await page.getByRole('link', { name: /Untitled lecture/ }).click()
  await page.getByTitle('Click to edit Lecture title').click()
  await page
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Named at last')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Named at last' }),
  ).toBeVisible()
})
