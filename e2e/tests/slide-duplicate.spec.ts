/**
 * e2e: duplicating a slide from its kebab menu. The copy lands immediately
 * after the source and becomes the active slide — the carousel flips to it,
 * and list view scrolls it into view.
 *
 * Not run as part of this slice's checks: it needs a built app plus Mongo
 * and MinIO, which only CI provides here.
 */
import { test, expect, type Page } from './fixtures'
import { chooseAccountDesign, createProject } from './helpers'

// The mock generator title-cases a slide's heading, so the second slide
// reads "Igneous, Sedimentary, Metamorphic" above its bullets. Match the
// phrase without pinning its casing.
const secondSlideText = /igneous, sedimentary, metamorphic/i

const email = `duplicate-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Duplicator')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await chooseAccountDesign(page, /classic/i)

  await createProject(page, 'Geology')
  await page
    .getByRole('button', { name: 'Start a new lecture in Geology' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByLabel('Spoken phrase').fill('Rock cycle basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(
    page.getByRole('heading', { name: 'Rock Cycle Basics' }),
  ).toBeVisible()

  await page
    .getByLabel('Spoken phrase')
    .fill('Igneous, sedimentary, metamorphic')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
}

test('duplicate slide: the copy is adjacent to its source and active', async ({
  page,
}) => {
  await buildDeck(page)

  // Speak leaves the second slide active; step back to the title slide and
  // duplicate it. Its copy is inserted right after it — slide 2 of 3 now —
  // and the view flips straight to the copy.
  // Speaking refocuses the phrase input, and arrow keys are ignored while
  // typing, so drop focus first or the deck never moves.
  await page.getByLabel('Spoken phrase').blur()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate slide' }).click()
  await expect(page.getByText('2 / 3')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )
  await expect(
    page.getByRole('heading', { name: 'Rock Cycle Basics' }),
  ).toBeVisible()

  // Stepping back lands on the untouched original, carrying the same title
  // the copy does — duplicating left it exactly as it was.
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 3')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Rock Cycle Basics' }),
  ).toBeVisible()
  // ...and stepping forward twice reaches the original second slide, now
  // pushed one place later by the insert.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('3 / 3')).toBeVisible()
  await expect(page.getByTestId('slide')).toContainText(secondSlideText)

  // List view: duplicating the last slide appends its copy, which scrolls
  // into view as the active one.
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(3)
  await page.getByRole('button', { name: 'Options for slide 3' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate slide' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(4)
  await expect(page.getByTestId('slide').nth(3)).toContainText(secondSlideText)
  await expect(page.getByTestId('slide').nth(3)).toBeInViewport()
})
