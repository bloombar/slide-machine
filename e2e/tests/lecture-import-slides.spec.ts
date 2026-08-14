/**
 * Creating a lecture from a Google Slides presentation end to end (EXP-5).
 *
 * The design analysis, the content mapping and the action are covered by unit
 * and integration tests. What only a browser can say is that one paste
 * produces a lecture an instructor can actually open and teach from — with
 * slides drawn in the imported design rather than an empty deck wearing it.
 *
 * Google is mock-backed, so the presentation read is the deliberately messy
 * sample deck (server/src/import/mock-presentation.ts).
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const stamp = Date.now()
const user = { email: `lecimport-${stamp}@example.com`, name: 'Importer' }
const password = 'sturdy-passw0rd'
const projectName = `LecImport${stamp}`

test('lecture import: paste a link, get a deck drawn in its own design', async ({
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
  await expect(page.getByLabel('Google Slides link')).toBeHidden()
  await page.getByRole('button', { name: 'Create new' }).click()
  await page
    .getByRole('menuitem', { name: 'Import from Google Slides' })
    .click()

  const field = page.getByLabel('Google Slides link')
  await expect(field).toBeVisible()

  // A link that is not one is refused before anything is sent.
  await field.fill('my lecture deck')
  await expect(
    page.getByRole('button', { name: 'Import lecture' }),
  ).toBeDisabled()

  await field.fill(
    `https://docs.google.com/presentation/d/1AbCdEf${stamp}/edit`,
  )
  await page.getByRole('button', { name: 'Import lecture' }).click()

  // This account has never connected Google — a missing step rather than a
  // failure, so the step is offered.
  const connect = page.getByRole('button', { name: 'Connect Google' })
  await expect(connect).toBeVisible({ timeout: 20_000 })
  await connect.click()
  await expect(connect).toBeHidden({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Import lecture' }).click()

  // The report is a deliverable: one read produced a lecture AND the template
  // its design became, and consolidation is a judgement worth stating.
  const report = page.getByTestId('lecture-import-report')
  await expect(report).toBeVisible({ timeout: 20_000 })
  await expect(report).toContainText(/10 slides became \d+ layouts/)
  await expect(report).toContainText(/nothing was changed in the presentation/i)

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
