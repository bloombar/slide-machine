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
import {
  chooseAccountDesign,
  createProject,
  openProjectSettings,
} from './helpers'

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
  // This spec is written against Classic — its box names and its geometry —
  // so it says so rather than riding on whatever the deployment defaults to
  // (TMPL-24).
  await chooseAccountDesign(page, /classic/i)

  // Exporting a design lives on its own page (EXP-6) — a built-in is
  // readable, so it exports like any other, and starting from one keeps the
  // round trip about the file rather than about how a template came to
  // exist. Reached directly by its permalink (a built-in's permalink is its
  // id), which keeps the spec independent of the Design templates page.
  await page.goto('/t/classic')
  await expect(page).toHaveURL(/\/t\//)
  await page.getByRole('button', { name: 'Export this design' }).click()
  const exportDialog = page.getByRole('dialog', { name: 'Export this design' })
  const downloadPromise = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'As YAML' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.template\.yaml$/)
  const saved = await download.path()
  // The file stands on its own: it says what it is, so the importer can tell
  // it from a deck export.
  expect(readFileSync(saved!, 'utf8')).toMatch(/kind: template/)

  // Import that same file back, from a lecture's own Design tab this time —
  // the same shared import control, opening in a dialog rather than inline
  // (TMPL-28). `createProject` needs the home screen's own "Create new"
  // menu, which the design's page just left behind.
  await page.goto('/app')
  await createProject(page, projectName)
  await page
    .getByRole('button', { name: `Start a new lecture in ${projectName}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Design' }).click()

  const previews = dialog.getByTestId('template-preview')
  // Waited for rather than counted straight away: `count()` samples once and
  // does not retry, so a list that has not painted yet reads as zero — which
  // is what made this spec fail under load while passing on its own.
  await expect(previews.first()).toBeVisible()

  // The three ways a design arrives share one panel, opened here in a dialog
  // over the settings sheet — the tab has one Import button, not three.
  await dialog.getByRole('button', { name: /^Import a design$/i }).click()
  const importDialog = page.getByRole('dialog', { name: 'Import a design' })
  await importDialog.getByLabel(/import a design file/i).setInputFiles(saved!)
  // A real template rather than a row in a list: the author's own copy,
  // chosen straight away, the way an import exists to be used. (Asserted by
  // what is applied rather than by counting cards, which infinite scroll can
  // change underneath the test — TMPL-28.)
  await expect(
    dialog.getByRole('radio', { checked: true, name: /Custom/ }),
  ).toBeVisible()
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
  // This spec is written against Classic — its box names and its geometry —
  // so it says so rather than riding on whatever the deployment defaults to
  // (TMPL-24).
  await chooseAccountDesign(page, /classic/i)

  await createProject(page, `${projectName}Bad`)
  await openProjectSettings(page, `${projectName}Bad`)
  await page.getByRole('tab', { name: 'Design' }).click()

  const previews = page.getByTestId('template-preview')
  // Waited for rather than counted straight away: `count()` samples once and
  // does not retry, so a list that has not painted yet reads as zero — which
  // is what made this spec fail under load while passing on its own.
  await expect(previews.first()).toBeVisible()

  await page.getByRole('button', { name: /^Import a design$/i }).click()
  await page.getByLabel(/import a design file/i).setInputFiles({
    name: 'week-1.deck.yaml',
    mimeType: 'application/x-yaml',
    // A deck export: valid YAML, wrong document.
    buffer: Buffer.from('version: 1\nkind: deck\ntitle: Week 1\nslides: []\n'),
  })

  await expect(page.getByRole('alert')).toContainText(/could not import/i)
  // Nothing was created: a refused import leaves the library as it was.
  // The applied design is untouched, and no design of the author's own was
  // made
  await expect(
    page.getByRole('radio', { checked: true, name: /^Classic$/ }),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: /Custom/ })).toHaveCount(0)
})
