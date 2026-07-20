/**
 * The MVP core loop end to end (mock generation provider): sign up →
 * create project → start a lecture with a template → phrases become
 * slides live → end session → deck plays back at its permalink.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

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

  // Create a project; the modal lands us on its page
  await createProject(page, 'Biology 101')

  // New lecture opens an untitled lecture; the pre-lecture seed dialog
  // shows first, and its "Start lecture" button drops into the live session
  await page
    .getByRole('button', { name: 'Start a new lecture in Biology 101' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Name it from the nav and pick the Midnight template in settings
  await page.getByTitle('Click to edit Lecture title').click()
  await page
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Photosynthesis')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design template' }).click()
  await page.getByRole('radio', { name: /midnight/i }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

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
  await expect(page.getByText('2 / 2')).toBeVisible()

  // A continuation phrase updates the current slide instead of adding one
  await page.getByLabel('Spoken phrase').fill('Also minerals from the soil')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('minerals from the soil')).toBeVisible()
  await expect(page.getByText('2 / 2')).toBeVisible()

  // Toggling the mic off hides the Speak bar; the deck stays put
  await page.getByRole('button', { name: 'Live session' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Spoken phrase' }),
  ).not.toBeVisible()
  await page.keyboard.press('ArrowLeft')
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
    .fill('**Photosynthesis** 101')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis 101' }),
  ).toBeVisible()
  // Markdown renders as formatting, not source
  await expect(page.getByTestId('slide').locator('strong')).toHaveText(
    'Photosynthesis',
  )
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis 101' }),
  ).toBeVisible()

  // Pointer-zone navigation (SlideNavZones): a chevron reveals only while the
  // cursor is over that half of the slide, so we move the mouse to reveal it,
  // then click. Mirrors a real cursor; a bare click would deadlock since the
  // chevron is pointer-events-none until revealed.
  const revealAndClick = async (name: 'Next slide' | 'Previous slide') => {
    const box = (await page.getByTestId('slide').boundingBox())!
    const x = box.x + box.width * (name === 'Next slide' ? 0.8 : 0.2)
    await page.mouse.move(x, box.y + box.height / 2)
    await page.getByRole('button', { name }).click()
  }
  await revealAndClick('Next slide')
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByText('carbon dioxide')).toBeVisible()
  await revealAndClick('Previous slide')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await revealAndClick('Next slide')

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

  // A session never really ends: the mic re-opens and speaking continues
  await page.getByRole('button', { name: 'Live session' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('What separates plants from animals?')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'quote',
  )
  await expect(page.getByText('3 / 3')).toBeVisible()
})
