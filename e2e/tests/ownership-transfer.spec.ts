/**
 * Ownership transfer end to end: the owner hands a lecture to an editor
 * from the per-person access menu; the old owner keeps editing but
 * loses the transfer option; the new owner gains it and sees the deck
 * under "Other lectures" at home (its project still belongs to the old
 * owner).
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { createProject } from './helpers'

const stamp = Date.now()
const alice = { email: `alice-${stamp}@example.com`, name: 'Alice' }
const bella = { email: `bella-${stamp}@example.com`, name: 'Bella' }
const password = 'sturdy-passw0rd'

const newUserPage = async (
  browser: Browser,
  user: { email: string; name: string },
): Promise<Page> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  return page
}

test('owner transfers a lecture; old owner stays an editor', async ({
  browser,
}) => {
  const alicePage = await newUserPage(browser, alice)
  const bellaPage = await newUserPage(browser, bella)

  // Alice builds a lecture and adds Bella as an editor
  await createProject(alicePage, 'TransferProj')
  await alicePage
    .getByRole('button', { name: 'Start a new lecture in TransferProj' })
    .click()
  await expect(alicePage).toHaveURL(/\/d\//)
  // Dismiss the pre-lecture seed dialog
  await alicePage.getByRole('button', { name: 'Start lecture' }).click()
  const deckUrl = alicePage.url()

  await alicePage.getByRole('button', { name: 'Lecture settings' }).click()
  await alicePage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await alicePage.getByLabel('Add people by email').fill(bella.email)
  await alicePage.getByLabel('Access role').selectOption('editor')
  await alicePage.getByRole('button', { name: 'Add', exact: true }).click()
  const bellaRow = alicePage.getByLabel(`Role for ${bella.name}`)
  await expect(bellaRow).toHaveValue('editor')

  // Transfer ownership from the per-person menu (confirming the dialog)
  await bellaRow.selectOption('transfer')
  await alicePage
    .getByRole('alertdialog', { name: 'Transfer ownership?' })
    .getByRole('button', { name: 'Transfer' })
    .click()

  // Alice is now an editor: the list re-reads with her in it, and her
  // own menu no longer offers a transfer
  const aliceRow = alicePage.getByLabel(`Role for ${alice.name}`)
  await expect(aliceRow).toHaveValue('editor')
  await expect(aliceRow.locator('option[value="transfer"]')).toHaveCount(0)
  await alicePage.getByRole('button', { name: 'Close settings' }).click()

  // Alice can still edit the lecture title in place
  await alicePage.getByTitle('Click to edit Lecture title').click()
  await alicePage
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Handover Done')
  await alicePage.keyboard.press('Enter')
  await expect(
    alicePage.getByRole('heading', { name: 'Handover Done' }),
  ).toBeVisible()

  // Bella now owns it: her settings menu offers transfer for Alice,
  // and the deck shows up at home under "Other lectures"
  await bellaPage.goto(deckUrl)
  await bellaPage.getByRole('button', { name: 'Lecture settings' }).click()
  await bellaPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await expect(
    bellaPage
      .getByLabel(`Role for ${alice.name}`)
      .locator('option[value="transfer"]'),
  ).toHaveCount(1)
  await bellaPage.getByRole('button', { name: 'Close settings' }).click()

  await bellaPage.goto('/app')
  await expect(bellaPage.getByText('Other lectures')).toBeVisible()
  await expect(
    bellaPage.getByRole('link', { name: /Handover Done/ }),
  ).toBeVisible()
})
