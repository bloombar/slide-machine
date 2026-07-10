/**
 * The MVP core loop end to end (mock generation provider): sign up →
 * create project → start a lecture with a template → phrases become
 * slides live → end session → deck plays back at its permalink.
 */
import { test, expect } from '@playwright/test'

const email = `core-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

test('speak-to-slides core loop, session to permalink playback', async ({
  page,
}) => {
  // Register and land in the app
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Core Looper')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Create a project and open it
  await page.getByLabel('New project title').fill('Biology 101')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: 'Biology 101' }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)

  // Start a lecture with the Midnight template
  await page.getByLabel('Lecture title').fill('Photosynthesis')
  await page.getByRole('radio', { name: /midnight/i }).click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await expect(page).toHaveURL(/\/app\/session\//)

  // Speak: a short opener becomes a title slide
  await page.getByLabel('Spoken phrase').fill('Photosynthesis basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis Basics' }),
  ).toBeVisible()

  // A comma list becomes a list slide
  await page
    .getByLabel('Spoken phrase')
    .fill('Plants need sunlight, water, carbon dioxide')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-layout', 'list')
  await expect(page.getByText('Slide 2 of 2')).toBeVisible()

  // A continuation phrase updates the current slide instead of adding one
  await page.getByLabel('Spoken phrase').fill('Also minerals from the soil')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('minerals from the soil')).toBeVisible()
  await expect(page.getByText('Slide 2 of 2')).toBeVisible()

  // End the session → permalink viewer with playback controls
  await page.getByRole('button', { name: 'End session' }).click()
  await expect(page).toHaveURL(/\/d\/photosynthesis-/)
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis Basics' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Next →' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByText('carbon dioxide')).toBeVisible()

  // Arrow keys navigate too (PLAY-1)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 2')).toBeVisible()
})
