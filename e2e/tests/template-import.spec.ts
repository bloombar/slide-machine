/**
 * Importing a design from Google Slides end to end (TMPL-8): connect an
 * account, paste a presentation link, and get a template back that the
 * library shows, the editor opens and a lecture can actually wear.
 *
 * The consolidation is proved by unit tests and the action by integration
 * tests. What only a browser can say is the part that matters most here — that
 * what comes out is a *usable design*: it renders as a slide in the library,
 * opens in the editor with the layouts the import derived, and applies to the
 * project without anything breaking.
 *
 * Google is mock-backed, so the presentation read is the deliberately messy
 * sample deck (server/src/import/mock-presentation.ts) — three real designs
 * rebuilt with jitter, plus one odd slide. Every consolidation pass runs.
 */
import { test, expect } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const stamp = Date.now()
const user = { email: `import-${stamp}@example.com`, name: 'Importer' }
const password = 'sturdy-passw0rd'
const projectName = `TmplImport${stamp}`
const link = `https://docs.google.com/presentation/d/1AbCdEf${stamp}/edit`

test('template import: connect, paste a link, get a usable design', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, projectName)
  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()

  const previews = page.getByTestId('template-preview')
  // Waited for rather than counted straight away: `count()` samples once and
  // does not retry, so a list that has not painted yet reads as zero — which
  // is what made this spec fail under load while passing on its own.
  await expect(previews.first()).toBeVisible()
  const before = await previews.count()
  expect(before).toBeGreaterThan(0)

  // The panel stays out of the way until asked for — importing is not what
  // most visits to this tab are about.
  await expect(page.getByLabel(/Google Slides or Drive link/i)).toBeHidden()
  await page.getByRole('button', { name: /^Import a design$/i }).click()

  const field = page.getByLabel(/Google Slides or Drive link/i)
  await expect(field).toBeVisible()

  // A link that is not one is refused before anything is sent, so the
  // instructor gets a clear complaint rather than a server error.
  await field.fill('my lecture deck')
  await expect(
    page.getByRole('button', { name: 'Import design' }),
  ).toBeDisabled()
  await expect(page.getByText(/doesn't look like/i)).toBeVisible()

  // The id is pulled out of the pasted URL; the instructor never sees one.
  await field.fill(link)
  await page.getByRole('button', { name: 'Import design' }).click()

  // This account has never connected Google, and that is a missing step
  // rather than a failure — so the panel offers the step instead of an error
  // the instructor cannot act on. Import needs no scope beyond the one already
  // used to browse Drive, so it is the same connection export uses
  // (docs/TEMPLATES.md §11).
  const connect = page.getByRole('button', { name: 'Connect Google' })
  await expect(connect).toBeVisible({ timeout: 20_000 })
  await connect.click()
  await expect(connect).toBeHidden({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Import design' }).click()

  // The report is a deliverable, not a nicety: it is the only account of what
  // the import made of the deck (TMPL-8).
  const report = page.getByTestId('import-report')
  await expect(report).toBeVisible({ timeout: 20_000 })
  await expect(report).toContainText(/10 slides → \d+ layouts/)
  await expect(report).toContainText(/your presentation wasn.t changed/i)

  // Every slide comes back as its own layout. Which slides are "the same
  // design" is a judgement, and one made silently leaves an author with
  // fewer layouts than slides and no way to see why — so it is offered
  // rather than taken (TMPL-8).
  const summary = (await report.textContent()) ?? ''
  const layouts = Number(/→ (\d+) layouts/.exec(summary)?.[1] ?? '0')
  expect(layouts).toBe(10)
  await expect(report).not.toContainText(/near-identical slides merged/)

  // It is a real template: in the library, rendered as a slide in its own
  // theme like any other, and already chosen — an import exists to be used.
  await expect(previews).toHaveCount(before + 1)
  const imported = page.getByRole('radio', { name: /Imported sample deck/i })
  await expect(imported).toBeVisible()
  await expect(imported).toHaveAttribute('aria-checked', 'true')

  // And an editable one, at a permalink of its own, carrying the layouts the
  // import derived plus the blank slate every template owes (TMPL-7).
  await page.getByRole('button', { name: /^Edit Imported sample deck/ }).click()
  await expect(page).toHaveURL(/\/t\//)
  await expect(page.getByTestId('template-canvas')).toBeVisible()
  await expect(page.getByLabel('Template name')).toHaveValue(
    'Imported sample deck',
  )

  // And a design that can be built on, not only restyled. An import arrives
  // as measured boxes with no tree, and the outline — with it adding,
  // removing and reordering boxes — exists only for a tree: an instructor
  // could import their own deck and then not add a box to it (TMPL-8).
  await expect(
    page.getByRole('heading', { name: 'Boxes in this layout' }),
  ).toBeVisible()

  // Counted by the controls the outline offers, one per box.
  const removable = page.getByRole('button', { name: /^Remove the .* box$/i })
  const boxesBefore = await removable.count()
  expect(boxesBefore).toBeGreaterThan(0)

  await page
    .getByRole('button', { name: /^Add a box inside/ })
    .first()
    .click()
  await expect(removable).toHaveCount(boxesBefore + 1)

  // And removed again, which is the other half of being editable.
  await removable.last().click()
  await expect(removable).toHaveCount(boxesBefore)
})

/**
 * The tidying an import can do, asked for rather than assumed (TMPL-8).
 *
 * A hand-built deck usually rebuilds one design many times over, and
 * recognising those as a single layout is what makes the result usable. It is
 * still a judgement about which slides count as the same design, so it is a
 * box the instructor ticks — and the report says what it did.
 */
test('ticking the box combines near-identical slides', async ({ page }) => {
  const email = `tidy-${stamp}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Tidy Er')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const project = `Tidy ${stamp}`
  await createProject(page, project)
  await openProjectSettings(page, project)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('button', { name: /^Import a design$/i }).click()

  const field = page.getByLabel(/Google Slides or Drive link/i)
  await expect(field).toBeVisible()
  await field.fill(link)
  await page
    .getByRole('checkbox', { name: /combine near-identical slides/i })
    .check()
  await page.getByRole('button', { name: 'Import design' }).click()

  // Same missing step as above: this account has never connected Google.
  const connect = page.getByRole('button', { name: 'Connect Google' })
  await expect(connect).toBeVisible({ timeout: 20_000 })
  await connect.click()
  await expect(connect).toBeHidden({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Import design' }).click()

  const report = page.getByTestId('import-report')
  await expect(report).toBeVisible({ timeout: 20_000 })
  const summary = (await report.textContent()) ?? ''
  const layouts = Number(/→ (\d+) layouts/.exec(summary)?.[1] ?? '0')
  expect(layouts).toBeGreaterThan(0)
  expect(layouts).toBeLessThan(10)
  await expect(report).toContainText(/near-identical slides merged/)
})
