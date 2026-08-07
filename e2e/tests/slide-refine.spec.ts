/**
 * Per-slide "Refine this slide with AI" e2e (GEN-4): the kebab opens the
 * options dialog rather than refining immediately, the dialog's choices scope
 * what runs, and the refined slide lands in the deck. The mock generator stamps
 * the level it refined at into the slide's caption, so the chosen strength is
 * checkable in the action's result.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
const PHRASE = 'Mitochondria produce energy for the cell'

/** Registers a user and dictates one phrase, yielding a one-slide lecture. */
const buildDeck = async (page: Page, who: string) => {
  const project = `Refine ${who}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Refiner')
  await page.getByLabel('Email').fill(`refine-${who}-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill(PHRASE)
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
}

const openRefineDialog = async (page: Page) => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page
    .getByRole('menuitem', { name: 'Refine this slide with AI' })
    .click()
  return page.getByRole('dialog', { name: /Refine this slide with AI/ })
}

test('the kebab opens refine options, which scope what runs', async ({
  page,
}) => {
  await buildDeck(page, 'options')
  const dialog = await openRefineDialog(page)

  // Slide passes start on, the narration off; speaker ID needs recorded audio,
  // which a typed phrase never produced.
  await expect(
    dialog.getByRole('checkbox', { name: /Refine slide text/ }),
  ).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: /Identify multiple speakers/ }),
  ).toBeDisabled()

  // Cancelling runs nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // Refine the text at strength 4, leaving the narration alone.
  const reopened = await openRefineDialog(page)
  await reopened
    .getByRole('slider', { name: 'How much to refine this slide' })
    .fill('4')
  const refined = page.waitForResponse(
    r => r.url().includes('/actions/deck.refineSlide') && r.status() === 200,
  )
  await reopened.getByRole('button', { name: 'Refine' }).click()

  const body = await (await refined).json()
  expect(body.refined).toBe(true)
  // The mock generator stamps the level it refined at into the caption, which
  // is where the chosen strength is observable (the content layout has no
  // caption slot, so nothing about it is on screen).
  expect(body.slide.caption).toBe('Refined (level 4)')
  await expect(reopened).toBeHidden()

  // It persists: the reloaded deck carries the refined slide.
  const view = page.waitForResponse(
    r => /\/api\/decks\/[^/]+$/.test(r.url()) && r.status() === 200,
  )
  await page.reload()
  expect((await (await view).json()).slides[0].caption).toBe(
    'Refined (level 4)',
  )
})

test('refining only the narration leaves the slide’s words alone', async ({
  page,
}) => {
  await buildDeck(page, 'narration')
  const dialog = await openRefineDialog(page)

  for (const part of [
    /Refine slide text/,
    /Refine slide layout/,
    /Refine slide imagery/,
  ])
    await dialog.getByRole('checkbox', { name: part }).uncheck()
  await dialog
    .getByRole('checkbox', { name: /Refine the spoken transcript/ })
    .check()

  const refined = page.waitForResponse(
    r => r.url().includes('/actions/deck.refineSlide') && r.status() === 200,
  )
  await dialog.getByRole('button', { name: 'Refine' }).click()
  const body = await (await refined).json()

  expect(body.refined).toBe(false)
  expect(body.narrationUpdated).toBe(true)
  // The slide keeps its content; only what it says aloud changed.
  expect(body.slide.caption).toBeUndefined()
  await expect(page.getByTestId('slide')).toContainText('Mitochondria')
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Edit spoken transcript' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Spoken transcript' }),
  ).toHaveValue(`${PHRASE} (refined)`)
})
