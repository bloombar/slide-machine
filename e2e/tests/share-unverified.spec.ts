/**
 * Sharing asks the sharer to confirm their own address first (SHARE-3,
 * AUTH-3), end to end.
 *
 * Sharing sends mail carrying text the sharer chose and hands someone else
 * access, so an account that has never confirmed its address is refused —
 * and told so in a dialog offering a fresh confirmation link, rather than
 * shown the failure a mistyped address gets.
 */
import { test, expect } from './fixtures'
import { chooseAccountDesign, createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const unconfirmed = {
  email: `unconfirmed-${stamp}@example.com`,
  name: 'Unconfirmed',
}
const password = 'sturdy-passw0rd'

test('sharing is refused until the sharer confirms their own address', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(unconfirmed.name)
  await page.getByLabel('Email').fill(unconfirmed.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await chooseAccountDesign(page, /classic/i)

  await createProject(page, 'UnconfirmedProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in UnconfirmedProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await page
    .getByLabel('Add people by email')
    .fill(`someone-${stamp}@example.com`)
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // The dialog explains the refusal and offers the way out
  const dialog = page.getByRole('dialog', {
    name: 'Confirm your email address first',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Send another link' }).click()
  await expect(dialog.getByText('Sent — check your email.')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // Nobody was added, and nothing was invited
  await expect(page.getByText('Only you have access so far.')).toBeVisible()

  // Confirming the address makes the same share work
  await verifyEmail(page, unconfirmed.email)
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await page
    .getByLabel('Add people by email')
    .fill(`someone-${stamp}@example.com`)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Invited')).toBeVisible()
})
