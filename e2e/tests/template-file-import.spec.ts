/**
 * The template round trip end to end (EXP-3): export a design to a file, then
 * import that file back and get the design.
 *
 * The parser and the action are covered by unit and integration tests. What
 * only a browser can prove is that the two halves meet — that the file the
 * download actually produced is one the import screen actually accepts, and
 * that what comes back is a usable template: in the library, chosen, and
 * openable in the editor.
 *
 * EXP-3 calls the round trip "a stated guarantee, not a hope". This is the
 * test that makes it one from end to end.
 */
import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const stamp = Date.now()
const user = { email: `tmplfile-${stamp}@example.com`, name: 'Round Tripper' }
const password = 'sturdy-passw0rd'
const projectName = `TmplFile${stamp}`

test('template round trip: export a design to a file, import it back', async ({
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
  const before = await previews.count()
  expect(before).toBeGreaterThan(0)

  // A design of the instructor's own to export: built-ins are read-only, so
  // the round trip starts from a duplicate, which is how one is created.
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await expect(previews).toHaveCount(before + 1)

  // Export it to the file the importer consumes.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'As YAML' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.template\.yaml$/)
  const saved = await download.path()
  const exported = readFileSync(saved, 'utf8')
  // The file stands on its own: it says what it is, so the importer can tell
  // it from a deck export.
  expect(exported).toMatch(/kind: template/)

  // Import that same file back. The count going up by one is the whole
  // claim — the design left as a file and came back as a template.
  const afterExport = await previews.count()
  await page.getByLabel(/import a template file/i).setInputFiles(saved)
  await expect(previews).toHaveCount(afterExport + 1)

  // And it is a real template, not a row in a list: chosen straight away, and
  // openable in the editor at a permalink of its own.
  const imported = page.getByRole('radio', { checked: true })
  await expect(imported).toBeVisible()
  await page
    .getByRole('button', { name: /^Edit / })
    .first()
    .click()
  await expect(page).toHaveURL(/\/t\//)
  await expect(page.getByTestId('template-canvas')).toBeVisible()
})

test('a file that is not a template is refused, and says why', async ({
  page,
}) => {
  // A template import substitutes nothing (EXP-3), so the refusal has to name
  // what is wrong — an instructor cannot fix "import failed".
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Refuser')
  await page.getByLabel('Email').fill(`tmplbad-${stamp}@example.com`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, `${projectName}Bad`)
  await openProjectSettings(page, `${projectName}Bad`)
  await page.getByRole('tab', { name: 'Design' }).click()

  const previews = page.getByTestId('template-preview')
  const before = await previews.count()

  await page.getByLabel(/import a template file/i).setInputFiles({
    name: 'week-1.deck.yaml',
    mimeType: 'application/x-yaml',
    // A deck export: valid YAML, wrong document.
    buffer: Buffer.from('version: 1\nkind: deck\ntitle: Week 1\nslides: []\n'),
  })

  await expect(page.getByRole('alert')).toContainText(/could not import/i)
  // Nothing was created: a refused import leaves the library as it was.
  await expect(previews).toHaveCount(before)
})
