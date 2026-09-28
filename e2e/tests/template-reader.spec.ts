/**
 * A design's own page for someone who cannot edit it (TMPL-29): a public
 * custom design and a built-in both show everything the editor shows — the
 * real `TemplateSettings`/`LayoutInspector`/`SlotInspector` fields, disabled
 * rather than absent — with nothing offered to add, delete or reorder, and
 * a Duplicate button that lands the reader in their own copy's editor.
 */
import { test, expect, type Page } from './fixtures'
import {
  createProject,
  openProjectSettings,
  verifyEmail,
  boxOutline,
} from './helpers'

const stamp = Date.now()
const owner = { email: `readerowner-${stamp}@example.com`, name: 'Author' }
const guest = { email: `readerguest-${stamp}@example.com`, name: 'Visitor' }
const password = 'sturdy-passw0rd'
const projectName = `ReaderShare${stamp}`
const designName = `Public Design ${stamp}`
const instructions = 'Write for a general audience, avoiding jargon.'
const boxInstruction =
  'The listing itself, exactly as it would be typed. Never a sentence about it.'

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

/** Everything a reader's page must not offer, on whichever layout and box
 * are on screen — proof that `readOnly` is doing something, since deleting
 * it from the rail or the outline would make one of these appear. */
const assertsNothingToChange = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Add layout' })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^Remove the .* layout$/ }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^Add a box inside / }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^Remove the .* box$/ }),
  ).toHaveCount(0)
  // Nothing on the page can be typed into or reselected — the rail's own
  // narrow-screen layout picker is the one `<select>` that still works, the
  // same gesture as clicking its tab, so it alone is exempted.
  await expect(
    page.locator('input:not(:disabled), textarea:not(:disabled)'),
  ).toHaveCount(0)
}

test('a reader sees a public design and a built-in read-only, and duplicates one (TMPL-29)', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()

  await register(ownerPage, owner)
  await register(guestPage, guest)
  await verifyEmail(ownerPage, owner.email)

  // The owner makes a design of their own, gives it an AI instruction, and
  // publishes it — the same duplicate-then-edit route template-sharing.spec
  // uses.
  await createProject(ownerPage, projectName)
  await openProjectSettings(ownerPage, projectName)
  await ownerPage.getByRole('tab', { name: 'Design' }).click()
  await ownerPage.getByRole('button', { name: 'Latest', exact: true }).click()
  await ownerPage
    .getByRole('button', { name: 'Duplicate Classic', exact: true })
    .click()
  await expect(ownerPage).toHaveURL(/\/t\//)
  await ownerPage.getByLabel('Template name').fill(designName)
  await ownerPage.getByLabel('Instructions for the AI').fill(instructions)
  await ownerPage.getByRole('button', { name: 'Save' }).click()
  await expect(ownerPage.getByTestId('template-saved')).toHaveText('Saved')
  await ownerPage.getByRole('radio', { name: /public/i }).click()
  await expect(ownerPage.getByRole('radio', { name: /public/i })).toBeChecked()
  const designUrl = ownerPage.url()

  // The guest opens it directly, without ever being shared with. The real
  // field is there, disabled rather than absent (TMPL-29).
  await guestPage.goto(designUrl)
  await expect(
    guestPage.getByRole('heading', { name: designName }),
  ).toBeVisible()
  await expect(guestPage.getByLabel('Template name')).toBeDisabled()
  // The design-wide instruction, in full.
  const aiInstructions = guestPage.getByLabel('Instructions for the AI')
  await expect(aiInstructions).toHaveValue(instructions)
  await expect(aiInstructions).toBeDisabled()
  // The design's own visibility, read out rather than editable.
  await expect(guestPage.getByLabel('Who can use it')).toBeDisabled()

  // A box's own instruction, reached by picking its layout and then the box
  // — the same two-step selection the editor uses, still live here.
  await guestPage.getByRole('tab', { name: /^Code$/ }).click()
  await boxOutline(guestPage).getByText('Program listing').click()
  const boxDescription = guestPage.getByLabel('What goes in it (for the AI)')
  await expect(boxDescription).toHaveValue(boxInstruction)
  await expect(boxDescription).toBeDisabled()

  await assertsNothingToChange(guestPage)

  // Duplicating lands the guest in the editor for a copy of their own.
  await guestPage.getByRole('button', { name: 'Duplicate' }).click()
  await expect(guestPage).toHaveURL(/\/t\//)
  await expect(guestPage).not.toHaveURL(designUrl)
  await expect(guestPage.getByLabel('Template name')).toBeEditable()

  // A built-in opens the same way, with no owner and nothing to duplicate
  // from a lecture first.
  await guestPage.goto('/t/classic')
  await expect(guestPage.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(guestPage.getByLabel('Template name')).toBeDisabled()
  await guestPage.getByRole('tab', { name: /^Code$/ }).click()
  await boxOutline(guestPage).getByText('Program listing').click()
  const builtinBoxDescription = guestPage.getByLabel(
    'What goes in it (for the AI)',
  )
  await expect(builtinBoxDescription).toHaveValue(boxInstruction)
  await expect(builtinBoxDescription).toBeDisabled()
  await assertsNothingToChange(guestPage)
})
