/**
 * Layout re-fit end to end (GENERATION_LAYOUT_REFIT on, mock provider):
 * a prose content slide that receives an enumerating continuation is
 * re-fitted to a list layout in place — same slide, migrated content —
 * per GEN-8 "re-fit the layout on update".
 */
import { test, expect } from '@playwright/test'

const email = `refit-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

test('an enumerating update refits the slide from content to list', async ({
  page,
}) => {
  // Register, create a project, start a lecture
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Refit Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await page.getByLabel('New project title').fill('Biology 201')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'Biology 201', exact: true }).click()
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\/untitled-/)

  // A prose phrase becomes a content slide
  await page
    .getByLabel('Spoken phrase')
    .fill('The cell membrane is a strong protective barrier')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'content',
  )
  await expect(
    page.getByText('The cell membrane is a strong protective barrier'),
  ).toBeVisible()

  // An enumerating continuation refits the SAME slide to a list:
  // the body migrates into the bullets, no new slide appears
  await page
    .getByLabel('Spoken phrase')
    .fill('Also it contains cholesterol, embedded proteins, glycolipids')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-layout', 'list')
  await expect(
    page.getByText('The cell membrane is a strong protective barrier'),
  ).toBeVisible()
  await expect(page.getByText('glycolipids')).toBeVisible()
  await expect(page.getByText('1 / 1')).toBeVisible()
})
