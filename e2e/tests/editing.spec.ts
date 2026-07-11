/**
 * EDIT-1 e2e: build a small deck, then edit with auto-save, switch
 * between carousel and list views, reorder, delete, and verify the
 * changes in the permalink viewer.
 */
import { test, expect, type Page } from '@playwright/test'

const email = `edit-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Editor')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByLabel('New project title').fill('Chemistry')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'Chemistry' }).click()

  await page.getByLabel('Lecture title').fill('Atoms')
  await page.getByRole('button', { name: 'Start lecture' }).click()

  for (const phrase of ['Atomic structure', 'Protons, neutrons, electrons']) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    await expect(page.getByTestId('slide')).toBeVisible()
  }
}

test('edit, reorder, and delete slides with auto-save', async ({ page }) => {
  await buildDeck(page)

  // Enter the editor from the project page (brand link goes home)
  await page.getByRole('link', { name: 'Slide Machine' }).click()
  await page.getByRole('link', { name: 'Chemistry' }).click()
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(page).toHaveURL(/\/app\/decks\/.+\/edit$/)

  // Carousel view is the default: edit the first slide's title; auto-save
  await expect(
    page.getByRole('button', { name: 'Carousel view' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Slide title').fill('Introduction to Atoms')
  await expect(page.getByText('Saved')).toBeVisible()

  // Switch to list view: both slides visible and editable at once
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByText('Slide 1')).toBeVisible()
  await expect(page.getByText('Slide 2')).toBeVisible()
  await expect(page.getByLabel('Slide title').first()).toHaveValue(
    'Introduction to Atoms',
  )

  // Reorder: move slide 2 up
  await page.getByRole('button', { name: 'Move slide 2 up' }).click()
  await expect(page.getByLabel('Slide title').first()).not.toHaveValue(
    'Introduction to Atoms',
  )

  // Delete the (now) second slide
  await page.getByRole('button', { name: 'Delete slide 2' }).click()
  await expect(page.getByText('Slide 2')).not.toBeVisible()

  // The permalink viewer reflects everything (lecture title links to it)
  await page.getByRole('link', { name: 'Slide Machine' }).click()
  await page.getByRole('link', { name: 'Atoms' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Protons, Neutrons, Electrons/ }),
  ).toBeVisible()
})
