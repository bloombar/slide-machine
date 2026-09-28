/**
 * Import and export as dialogs (TMPL-28 / TMPL-29 / EXP-6): the Design
 * templates page offers the same "Import a design" control the Design tab
 * does, opening in a modal rather than inline, and a design's own page
 * offers "Export this design" in a modal of its own — the export options
 * that used to sit inline on the Design tabs, which no longer render them.
 *
 * The parser, the export action, and the round trip's own fidelity are all
 * covered elsewhere (`template-file-import.spec.ts`, `template-import.spec.ts`,
 * `imported-template-fidelity.spec.ts`). What is only this spec's is the
 * dialog wiring itself: a design imported from the page's own dialog stays
 * on the page with its report visible (exactly what the Design tab's own
 * import already does), switches the page to Mine so the new design shows
 * up there, and offers an explicit "Open design" action to its own page —
 * where the export dialog is the same `TemplateExportSection` the Design
 * tabs used to show inline.
 */
import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'

const stamp = Date.now()
const user = { email: `tmpldialogs-${stamp}@example.com`, name: 'Dialoger' }
const password = 'sturdy-passw0rd'

test('import a design from the Design templates page dialog, then export it from its own page dialog', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // A file to import: exported from a built-in, reached directly by its
  // permalink rather than through the Design templates page — built-ins
  // sort after every stored public design there and the e2e database
  // persists across runs, so Classic drops off page one long before this
  // spec ever runs (a built-in's permalink is its id).
  await page.goto('/t/classic')
  await expect(page).toHaveURL(/\/t\//)

  await page.getByRole('button', { name: 'Export this design' }).click()
  const firstExport = page.getByRole('dialog', { name: 'Export this design' })
  await expect(firstExport).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await firstExport.getByRole('button', { name: 'As YAML' }).click()
  const download = await downloadPromise
  const saved = await download.path()
  expect(readFileSync(saved!, 'utf8')).toMatch(/kind: template/)

  // Back to the Design templates page: Import a design sits in the header
  // row, opening in a dialog rather than unfolding inline.
  await page.goto('/app/templates')
  await page.getByRole('button', { name: /^Import a design$/i }).click()
  const importDialog = page.getByRole('dialog', { name: 'Import a design' })
  await expect(importDialog).toBeVisible()

  await importDialog.getByLabel(/import a design file/i).setInputFiles(saved!)

  // Identically to the Design tab: the dialog stays open — a file import has
  // no report to show (there was nothing to consolidate, only a straight
  // restore; the Google Slides half of the panel is what produces one,
  // covered by `template-import.spec.ts`) — rather than navigating away the
  // instant the import lands. The page has nothing of its own to apply the
  // import to in place, so it switches to Mine (where the new design now
  // lives) behind the still-open dialog, and offers "Open design" once it
  // has one to open.
  const openDesign = importDialog.getByRole('button', { name: 'Open design' })
  await expect(openDesign).toBeVisible()
  await expect(page).toHaveURL(/\/app\/templates$/)
  await expect(page.getByRole('button', { name: 'Mine' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // And "Open design" goes to the new design's own page, remembering this
  // page as where "Back" returns to.
  await openDesign.click()
  await expect(page).toHaveURL(/\/t\//)
  await expect(importDialog).not.toBeVisible()

  // Its own Export dialog offers the same three destinations, right back
  // where the round trip started.
  await page.getByRole('button', { name: 'Export this design' }).click()
  const secondExport = page.getByRole('dialog', { name: 'Export this design' })
  await expect(
    secondExport.getByRole('button', { name: 'As YAML' }),
  ).toBeVisible()
  await expect(
    secondExport.getByRole('button', { name: 'As PowerPoint' }),
  ).toBeVisible()
  await expect(
    secondExport.getByRole('button', { name: 'As Google Slides' }),
  ).toBeVisible()
})
