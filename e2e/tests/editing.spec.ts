/**
 * EDIT-1 e2e: slide text is edited in place from the deck viewer — the
 * app's single editing surface. Covers list view, Markdown source
 * roundtrip, and persistence.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const email = `edit-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Editor')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Chemistry')
  await page
    .getByRole('button', { name: 'Start a new lecture in Chemistry' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  // The pre-lecture seed dialog opens first; dismiss it to begin recording
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByTitle('Click to edit Lecture title').click()
  await page.getByRole('textbox', { name: 'Lecture title' }).fill('Atoms')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Atoms' })).toBeVisible()

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

  // Whole rows drag to reorder; Alt+arrows on a focused row is the
  // keyboard path
  await page.getByRole('listitem', { name: 'Slide 1' }).press('Alt+ArrowDown')
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
  await page.getByRole('listitem', { name: 'Slide 2' }).press('Alt+ArrowUp')
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'title',
  )

  // The slide kebab changes layouts via the picker (current highlighted,
  // source template named)
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Change slide layout' }),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Change slide layout' }),
  ).toContainText('Layouts from the Classic template')
  await expect(
    page.getByRole('radio', { name: /^Title Opening/ }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: /quote/i }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'quote',
  )

  // The quote layout's caption was empty and hidden before the switch —
  // the blank slot is clickable but invisible to the audience; a
  // page-background click flashes it as a skeleton, fading on its own
  const blankCaption = page.getByText('Add slide caption')
  await expect(blankCaption).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
  await page
    .locator('div.max-w-5xl')
    .first()
    .click({ position: { x: 5, y: 5 } })
  await expect(blankCaption).toHaveCSS(
    'background-color',
    'rgba(148, 163, 184, 0.35)',
  )
  await expect(blankCaption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await blankCaption.click()
  await page
    .getByRole('textbox', { name: 'Slide caption' })
    .fill('Dalton, 1803')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('slide').first()).toContainText('Dalton, 1803')

  // ...and deletes a slide with no confirmation
  await page.getByRole('button', { name: 'Options for slide 2' }).click()
  await page.getByRole('menuitem', { name: 'Delete slide' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(1)
  await page.reload()
  // The reload now preserves the view (list, from earlier); the rest of
  // this test asserts carousel behaviour, so return to it explicitly —
  // the choice then persists across the later reload too
  await page.getByRole('button', { name: 'Carousel view' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'quote',
  )
  await expect(page.getByTestId('slide')).toContainText('Dalton, 1803')

  // Lecture settings open as a full-width modal over the viewer
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Lecture settings' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /classic/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('radio', { name: /seminar/i }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // Escape closes the modal and returns to the slides
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByTestId('slide')).toBeVisible()

  // The switch persisted: reopen after a reload and check
  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // The add icon appends a starter slide at the end
  await page.getByRole('button', { name: 'Add slide', exact: true }).click()
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
