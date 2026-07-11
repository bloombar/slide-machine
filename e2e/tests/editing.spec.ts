/**
 * EDIT-1 e2e: slide text is edited in place from the deck viewer — the
 * app's single editing surface. Covers list view, Markdown source
 * roundtrip, and persistence.
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

test('in-place editing in the viewer, including list view and bullets', async ({
  page,
}) => {
  await buildDeck(page)

  // Open the deck in the viewer via the home screen
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await page.getByRole('link', { name: 'Atoms' }).click()
  await expect(page).toHaveURL(/\/d\//)

  // Rename the lecture itself from the header
  await page.getByTitle('Click to edit Lecture title').click()
  await page
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Atoms, Revised')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Atoms, Revised' }),
  ).toBeVisible()

  // Edit the title slide's text in place
  await page.getByTitle('Click to edit Slide title').click()
  await page
    .getByRole('textbox', { name: 'Slide title' })
    .fill('Introduction to Atoms')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Introduction to Atoms' }),
  ).toBeVisible()

  // List view: every slide is editable up-front; edit a bullet in place
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(2)
  await page.getByTitle('Click to edit Slide bullets').click()
  await page
    .getByRole('textbox', { name: 'Slide bullets' })
    .fill('protons\n**neutrons**')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('slide').last().locator('strong')).toHaveText(
    'neutrons',
  )

  // Everything persists across a fresh page load
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Introduction to Atoms' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide').last().locator('strong')).toHaveText(
    'neutrons',
  )

  // Drag handles reorder slides; Alt+arrows is the keyboard path
  await page
    .getByRole('button', { name: 'Reorder slide 1' })
    .press('Alt+ArrowDown')
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
  await page.reload()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
  await page
    .getByRole('button', { name: 'Reorder slide 2' })
    .press('Alt+ArrowUp')
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'title',
  )

  // The superimposed delete icon removes a slide permanently
  await page.getByRole('button', { name: 'Delete slide 2' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(1)
  await page.reload()
  await expect(page.getByText('1 / 1')).toBeVisible()

  // The add icon appends a starter slide at the end
  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New slide' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('1 / 2')).toBeVisible()

  // Line breaks entered while editing are preserved in the rendered text
  await page.keyboard.press('ArrowRight')
  await page.getByTitle('Click to edit Slide body').click()
  await page
    .getByRole('textbox', { name: 'Slide body' })
    .fill('line one\nline two')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('slide').locator('br')).toHaveCount(1)
  await expect(page.getByTestId('slide')).toContainText('line two')
})
