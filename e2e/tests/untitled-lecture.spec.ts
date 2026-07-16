/**
 * Untitled lectures end to end: the per-project + option on the home
 * screen leads to the start form, Start lecture works with no title,
 * the interface shows "Untitled lecture" everywhere while the data
 * keeps an empty title, and naming it later works in place.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

const email = `untitled-${Date.now()}@example.com`

test('untitled lectures start from the + option and can be named later', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Untitler')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'QuickStart')

  // New lecture starts an untitled lecture directly
  await page
    .getByRole('button', { name: 'Start a new lecture in QuickStart' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await expect(
    page.getByRole('heading', { name: 'Untitled lecture' }),
  ).toBeVisible()

  // Home lists it as Untitled lecture too
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await expect(
    page.getByRole('link', { name: /Untitled lecture/ }),
  ).toBeVisible()

  // Speaking earns an AI title once the topic is clear (second phrase
  // with the mock provider) — saved server-side, live in the header
  await page.getByRole('link', { name: /Untitled lecture/ }).click()
  await page.getByRole('button', { name: 'Live session' }).click()
  await page.getByLabel('Spoken phrase').fill('Photosynthesis basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Untitled lecture' }),
  ).toBeVisible()
  await page
    .getByLabel('Spoken phrase')
    .fill('Plants convert light into energy')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(
    page.getByRole('heading', {
      name: 'Plants Convert Light Into Energy',
      level: 1,
    }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: 'Plants Convert Light Into Energy',
      level: 1,
    }),
  ).toBeVisible()

  // Renaming by hand still works — the AI never overwrites it

  await page.getByTitle('Click to edit Lecture title').click()
  await page
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Named at last')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Named at last' }),
  ).toBeVisible()

  // Danger zone: deletion asks for confirmation, then leads home
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('button', { name: 'Delete lecture' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete lecture?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()

  await page.getByRole('button', { name: 'Delete lecture' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete lecture?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Named at last')).toHaveCount(0)
  // The permalink is dead too
  await page.goBack()
  await expect(
    page.getByText('This deck does not exist or is private'),
  ).toBeVisible()
})
