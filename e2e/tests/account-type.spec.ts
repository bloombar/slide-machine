/**
 * The account type, end to end (AUTH-6).
 *
 * It once chose the privacy defaults an account's work started from, and was
 * asked in a modal that nothing dismissed but an answer. The question is now
 * gone from the interface entirely — settings offers no account-type control.
 * What is worth proving is therefore absence — nothing blocks a new account,
 * and nothing asks what it is — plus the one rule that does still hold a
 * project back: an address nobody has confirmed (AUTH-3).
 */
import { test, expect, type Page } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const stamp = Date.now()
const password = 'sturdy-passw0rd'

/** Registers and lands in the app. */
const register = async (page: Page, email: string, name: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

/** Creates a project and opens the tab that shows what it was created as. */
const createProjectAndOpenPrivacy = async (page: Page, title: string) => {
  await createProject(page, title)
  await openProjectSettings(page, title)
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
}

test('a new account is asked nothing and can start straight away', async ({
  page,
}) => {
  const email = `plain-${stamp}@example.com`
  await register(page, email, 'Ada Plain')

  // Nothing in the way: the home page is usable on arrival.
  await expect(
    page.getByRole('heading', { name: /Which best describes you/i }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New lecture' })).toBeVisible()

  // And settings never asks either: the account-type control is gone.
  await page.goto('/app/settings?tab=privacy')
  await expect(
    page.getByRole('checkbox', { name: 'Public profile' }),
  ).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Account type' }),
  ).toHaveCount(0)
})

test('an unconfirmed address still starts a project restricted', async ({
  page,
}) => {
  // The rule that survives (AUTH-3): publishing on behalf of an account
  // nobody has proved they own is publishing without ever being asked.
  const email = `unconfirmed-${stamp}@example.com`
  await register(page, email, 'Un Confirmed')

  await createProjectAndOpenPrivacy(page, 'UnconfirmedProj')
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()
})
