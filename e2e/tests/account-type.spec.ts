/**
 * The account type, end to end (AUTH-6).
 *
 * It once chose the privacy defaults an account's work started from, and was
 * asked in a modal that nothing dismissed but an answer. Two things came of
 * that: a signed-in account met a question before it could do anything, and
 * a student's lectures were created restricted by a decision the student
 * never made.
 *
 * It is a plain profile field now. What is worth proving is therefore mostly
 * absence — nothing blocks a new account, and saying "student" re-scopes
 * nothing — plus the one rule that does still hold a project back: an
 * address nobody has confirmed (AUTH-3).
 */
import { test, expect, type Page } from './fixtures'
import { createProject, openProjectSettings, verifyEmail } from './helpers'

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

  // And the account has said nothing about itself, which is allowed.
  await page.goto('/app/settings?tab=privacy')
  await expect(
    page.getByRole('combobox', { name: 'Account type' }),
  ).toHaveValue('')
})

test('saying "student" changes nothing about privacy', async ({ page }) => {
  const email = `student-${stamp}@example.com`
  await register(page, email, 'Stu Dent')
  // Confirmed, so what follows is the account type's doing (or not) rather
  // than the unconfirmed-account rule reaching the same answer.
  await verifyEmail(page, email)

  await page.goto('/app/settings?tab=privacy')
  await page
    .getByRole('combobox', { name: 'Account type' })
    .selectOption('student')
  await expect(
    page.getByRole('combobox', { name: 'Account type' }),
  ).toHaveValue('student')

  // The profile is where it was — public — because saying what you are is
  // not a privacy decision.
  await expect(
    page.getByRole('checkbox', { name: 'Public profile' }),
  ).toBeChecked()

  // And the next project is created public, as everyone's is.
  await page.goto('/app')
  await createProjectAndOpenPrivacy(page, 'StudentProj')
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()
})

test('the choice survives a reload, and can be taken back', async ({
  page,
}) => {
  const email = `switch-${stamp}@example.com`
  await register(page, email, 'Switch Er')

  await page.goto('/app/settings?tab=privacy')
  const select = page.getByRole('combobox', { name: 'Account type' })
  await select.selectOption('educator')
  await page.reload()
  await expect(select).toHaveValue('educator')

  await select.selectOption('other')
  await page.reload()
  await expect(select).toHaveValue('other')
})

test('an unconfirmed address still starts a project restricted', async ({
  page,
}) => {
  // The rule that survives (AUTH-3): publishing on behalf of an account
  // nobody has proved they own is publishing without ever being asked.
  const email = `unconfirmed-${stamp}@example.com`
  await register(page, email, 'Un Confirmed')

  await page.goto('/app/settings?tab=privacy')
  await page
    .getByRole('combobox', { name: 'Account type' })
    .selectOption('educator')

  await page.goto('/app')
  await createProjectAndOpenPrivacy(page, 'UnconfirmedProj')
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()
})
