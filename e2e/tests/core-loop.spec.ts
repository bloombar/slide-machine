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

  // Pasting the permalink directly (fresh page load) also works for the
  // owner of a private deck — session restore precedes the deck fetch
  await page.reload()
  await expect(page.getByText('1 / 2')).toBeVisible()

  // Owners edit slide text in place from the viewer; text clicks win
  // over the prev/next hotspots, and the change persists
  await page.getByTitle('Click to edit Slide title').click()
  await page
    .getByRole('textbox', { name: 'Slide title' })
    .fill('Photosynthesis 101')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis 101' }),
  ).toBeVisible()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis 101' }),
  ).toBeVisible()

  // Hover-zone navigation: half-slide hotspots (click implies hover).
  // Clicks land near the zone's top corner — editable text sits above
  // the hotspots by design, so center clicks would edit, not navigate.
  const zoneClick = { position: { x: 20, y: 20 } }
  await page.getByRole('button', { name: 'Next slide' }).click(zoneClick)
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByText('carbon dioxide')).toBeVisible()
  await page.getByRole('button', { name: 'Previous slide' }).click(zoneClick)
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Next slide' }).click(zoneClick)

  // Arrow keys navigate too (PLAY-1)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 2')).toBeVisible()

  // The viewer offers the same carousel/list switch as every slide view
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(2)
  await page.getByRole('button', { name: 'Carousel view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(1)

  // Ending a session never closes it: the owner can resume and continue
  await page.getByRole('link', { name: 'Resume lecture' }).click()
  await expect(page).toHaveURL(/\/app\/session\//)
  await expect(page.getByText('Slide 2 of 2')).toBeVisible()

  await page
    .getByLabel('Spoken phrase')
    .fill('What separates plants from animals?')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'quote',
  )
  await expect(page.getByText('Slide 3 of 3')).toBeVisible()
})
