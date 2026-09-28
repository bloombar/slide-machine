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
 * dialog wiring itself: a design imported from the page's own dialog lands
 * on its own page, and that page's export dialog is the same
 * `TemplateExportSection` the Design tabs used to show inline.
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

  // A file to import: exported from a built-in, reached as a plain link
  // from the Design templates page — the same page this spec comes back to
  // for the import half below.
  await page.goto('/app/templates')
  await page
    .getByRole('link', { name: /classic/i })
    .first()
    .click()
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
  expect(await page.getByRole('dialog').count()).toBe(0)
  await page.getByRole('button', { name: /^Import a design$/i }).click()
  const importDialog = page.getByRole('dialog', { name: 'Import a design' })
  await expect(importDialog).toBeVisible()

  await importDialog.getByLabel(/import a design file/i).setInputFiles(saved!)

  // A successful import here lands on the new design's own page — the same
  // "chosen straight away" landing the Design tab's import gives, adapted to
  // a page that has nothing of its own to select it into.
  await expect(page).toHaveURL(/\/t\//)
  await expect(importDialog).not.toBeVisible()

  // And its own Export dialog offers the same three destinations, right back
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
