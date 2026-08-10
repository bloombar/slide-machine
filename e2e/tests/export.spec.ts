/**
 * Deck export end to end (EXP-1/EXP-2/EXP-4): an instructor opens a lecture's
 * settings Export tab, downloads the deck as a PDF, and saves it to Google
 * Slides in a Drive folder they create. The Google side is mock-backed
 * (EXPORT_MODE defaults to mock), so the full flow runs with the live
 * front/back end and test DB; the PDF download is produced for real.
 */
import { test, expect } from './fixtures'
import { readFile } from 'node:fs/promises'
import { createProject, openProjectSettings } from './helpers'

test('export a lecture to PDF download and Google Slides in Drive', async ({
  page,
}) => {
  // A lecture with one slide to export
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Exporter')
  await page.getByLabel('Email').fill(`export-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'ExportProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in ExportProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Photosynthesis happens in the chloroplasts')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Open the Export tab in lecture settings
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Export' }).click()

  // Download a PDF (produced for real by the server)
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)

  // Switch to Google Slides — it is Drive-only, so connect Google first
  await dialog.getByRole('radio', { name: /Google Slides/ }).check()
  await expect(
    dialog.getByText(/always saved to your Google Drive/i),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Connect Google' }).click()
  await dialog
    .getByRole('button', { name: 'Save Google Slides to Drive' })
    .click()

  // Create a destination folder in the picker, then save into it
  const picker = page.getByRole('dialog', { name: 'Choose a Drive folder' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'New folder' }).click()
  await picker.getByLabel('New folder name').fill('E2E Exports')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(
    picker.getByRole('button', { name: 'E2E Exports' }),
  ).toBeVisible()
  await picker.getByRole('button', { name: 'Save here' }).click()

  // The resulting Google Slides link appears (in the confirmation and the
  // "Saved to Drive" list), and the confirmation names the destination folder.
  await expect(
    dialog.locator('a[href*="docs.google.com/presentation"]').first(),
  ).toBeVisible()
  await expect(dialog.getByText(/Saved to E2E Exports/)).toBeVisible()
  // The saved export is listed and can be deleted.
  await expect(dialog.getByText('Saved to Drive')).toBeVisible()
})

test('export a design to Google Slides in Drive (EXP-6)', async ({ page }) => {
  // A template in Google Slides is just a presentation whose layouts define a
  // design, so exporting one has to produce exactly that — and only a live
  // browser can say the whole flow reaches Drive.
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Designer')
  await page.getByLabel('Email').fill(`design-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'DesignProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in DesignProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Design' }).click()

  // Drive-only, so it needs a connected account first — the Export tab is
  // where connecting lives.
  await dialog.getByRole('tab', { name: 'Export' }).click()
  await dialog.getByRole('radio', { name: /Google Slides/ }).check()
  await dialog.getByRole('button', { name: 'Connect Google' }).click()
  await dialog.getByRole('tab', { name: 'Design' }).click()

  await dialog.getByRole('button', { name: 'As Google Slides' }).click()

  const picker = page.getByRole('dialog', { name: 'Choose a Drive folder' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'New folder' }).click()
  await picker.getByLabel('New folder name').fill('E2E Designs')
  await picker.getByRole('button', { name: 'Create' }).click()
  await picker.getByRole('button', { name: 'Save here' }).click()

  // The design is in Drive, and opens in Slides rather than as a file
  const link = dialog.locator('a[href*="docs.google.com/presentation"]').first()
  await expect(link).toBeVisible()
  await expect(link).toHaveText(/open in google slides/i)
})

test('a formula exports as notation, and a broken one is reported (EXP-7)', async ({
  page,
}) => {
  // End to end: a design declares a maths box, a lecture fills it, and the
  // PDF that comes out carries typeset notation rather than LaTeX source.
  const stamp = Date.now()
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Physicist')
  await page.getByLabel('Email').fill(`maths-${stamp}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, `Maths${stamp}`)

  // A design with a formula box, made the way an author makes one
  await openProjectSettings(page, `Maths${stamp}`)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await expect(page).toHaveURL(/\/t\//)
  await page.getByRole('tab', { name: /Content/ }).click()
  await page.getByRole('list').last().getByText('Slide body').click()
  await page.getByLabel('What is it').selectOption('math')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('template-saved')).toHaveText('Saved')

  // A lecture on that design, with a formula typed into the box
  await page.goto('/app')
  await page
    .getByRole('button', { name: `Start a new lecture in Maths${stamp}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Velocity under gravity')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // The generated slide opens on the title layout; the formula box is on
  // Content, so move the slide onto it.
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  await page.getByRole('radio', { name: /^Content/ }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'content',
  )

  // The box shows itself as empty and takes a formula (EDIT-7)
  const slide = page.getByTestId('slide').first()
  await slide.getByText('Add a formula').click()
  await page.getByLabel('Slide body').fill('v = gt')
  // Escape would cancel; a multi-line field commits on Ctrl+Enter
  await page.keyboard.press('Control+Enter')
  await expect(slide.locator('.katex').first()).toBeVisible()

  // The PDF is produced for real by the server
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Export' }).click()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)

  // The file itself, not just the fact that one arrived: the formula is in
  // it as an embedded picture, and its LaTeX is nowhere.
  const path = await download.path()
  const pdf = await readFile(path)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/)

  // Nothing to report: the formula typeset, so it went in as notation
  await expect(
    dialog.getByText(/could not be carried into this file/i),
  ).toHaveCount(0)
})
