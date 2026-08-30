/**
 * Creating a lecture from a Google Slides presentation end to end (EXP-5).
 *
 * The design analysis, the content mapping and the action are covered by unit
 * and integration tests. What only a browser can say is that choosing one file
 * produces a lecture an instructor can actually open and teach from — with
 * slides drawn in the imported design rather than an empty deck wearing it.
 *
 * Google is mock-backed, so the chooser is the app's own dialog over a
 * fabricated Drive (live it is Google's Picker, which a browser test cannot
 * drive), and the presentation read is the deliberately messy sample deck
 * (server/src/import/mock-presentation.ts).
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const stamp = Date.now()
const user = { email: `lecimport-${stamp}@example.com`, name: 'Importer' }
const password = 'sturdy-passw0rd'
const projectName = `LecImport${stamp}`

test('lecture import: pick a presentation, get a deck drawn in its own design', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Creating a project lands on its own page, which is where lectures start.
  await createProject(page, projectName)
  await expect(page.getByRole('heading', { name: 'Lectures' })).toBeVisible()

  // The import stays out of the way until asked for: most visits to a project
  // are not about starting from an existing deck.
  const choose = page.getByRole('button', { name: 'Choose a presentation' })
  await expect(choose).toBeHidden()
  await page.getByRole('button', { name: 'Create new' }).click()
  // One import entry: the panel asks which source, rather than the menu.
  await page.getByRole('menuitem', { name: 'Import a lecture' }).click()
  await expect(choose).toBeVisible()

  // Nothing to import until something is chosen.
  await expect(
    page.getByRole('button', { name: 'Import lecture' }),
  ).toBeDisabled()

  // This account has never connected Google, so the first open of the picker
  // is a missing step rather than a failure — and taking it lands back at the
  // files rather than at a closed panel.
  await choose.click()
  const reconnect = page.getByRole('button', { name: 'Reconnect Google' })
  await expect(reconnect).toBeVisible({ timeout: 20_000 })
  await reconnect.click()

  const picker = page.getByRole('dialog', { name: 'Choose from Google Drive' })
  await expect(picker).toBeVisible({ timeout: 20_000 })
  await picker.getByRole('button', { name: 'Rainwater Harvesting' }).click()

  await page.getByRole('button', { name: 'Import lecture' }).click()

  // What happened is said beside the lecture, not in a panel that has gone:
  // a finished import closes rather than sitting over the list it added to.
  await expect(page.getByText(/10 slides became \d+ layouts/)).toBeVisible({
    timeout: 20_000,
  })
  await expect(choose).toBeHidden()

  // The lecture is real: listed, and it opens with slides already on it —
  // an import that produced an empty deck wearing the design would pass every
  // check above and be useless.
  const lecture = page.getByRole('link', { name: /Imported sample deck/i })
  await expect(lecture.first()).toBeVisible({ timeout: 20_000 })
  await lecture.first().click()
  await expect(page).toHaveURL(/\/d\//)
  await expect(page.getByTestId('slide').first()).toBeVisible({
    timeout: 20_000,
  })
})
