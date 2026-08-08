/**
 * The account-type prompt and the privacy defaults it chooses, end to end
 * (AUTH-6 / P-1): a new account is asked once, a student's profile and new
 * projects start private, an educator's stay public, and the answer is
 * changeable afterwards in account settings.
 *
 * This is the one spec that imports Playwright's own `test` rather than the
 * shared fixture — the fixture answers the prompt for every other spec, and
 * this one is about the prompt.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject, openProjectSettings, verifyEmail } from './helpers'

const stamp = Date.now()
const password = 'sturdy-passw0rd'

/** Registers and lands in the app, where the prompt is waiting. */
const register = async (page: Page, email: string, name: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

const prompt = (page: Page) =>
  page.getByRole('heading', { name: 'Which best describes you?' })

/**
 * Answers the prompt, then confirms the address (AUTH-3).
 *
 * The confirmation matters to what follows: an unconfirmed account's
 * projects start restricted whatever it says it is, so without it a
 * restricted project would prove nothing about the account type, and a
 * public one could not happen at all.
 */
const answerAndConfirm = async (page: Page, email: string, choice: RegExp) => {
  await expect(prompt(page)).toBeVisible()
  await page.getByRole('button', { name: choice }).click()
  await expect(prompt(page)).toBeHidden()
  await verifyEmail(page, email)
}

/** Creates a project and opens the tab that shows what it was created as. */
const createProjectAndOpenPrivacy = async (page: Page, title: string) => {
  await createProject(page, title)
  await openProjectSettings(page, title)
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
}

/** Opens the Privacy & Sharing tab of a project listed on the home page. */
const openProjectPrivacyFromHome = async (page: Page, title: string) => {
  await openProjectSettings(page, title)
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
}

test('a student account is asked once, and starts private', async ({
  page,
}) => {
  const email = `student-${stamp}@example.com`
  await register(page, email, 'Stu Dent')

  // Asked on arrival, and blocking: the answer chooses defaults, so it has
  // to land before the account creates anything.
  await expect(prompt(page)).toBeVisible()
  await expect(
    page.getByText('Your profile and new lectures start private.'),
  ).toBeVisible()

  await page.getByRole('button', { name: /^Student/ }).click()
  await expect(prompt(page)).toBeHidden()
  // Confirm the address, so what follows is the account type's doing and
  // not the unconfirmed-account rule (AUTH-3) reaching the same answer.
  await verifyEmail(page, email)

  // The profile turned private with the answer (SHARE-1)
  await page.goto('/app/settings?tab=privacy')
  await expect(
    page.getByRole('checkbox', { name: 'Public profile' }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('combobox', { name: 'Account type' }),
  ).toHaveValue('student')

  // ...and the next project is created restricted rather than public
  await page.goto('/app')
  await createProjectAndOpenPrivacy(page, 'StudentProj')
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()

  // Not asked again on a later visit
  await page.goto('/app')
  await expect(prompt(page)).toBeHidden()
})

test('an educator account keeps the public defaults', async ({ page }) => {
  const email = `educator-${stamp}@example.com`
  await register(page, email, 'Ed Ucator')
  await answerAndConfirm(page, email, /^Educator/)

  await page.goto('/app/settings?tab=privacy')
  await expect(
    page.getByRole('checkbox', { name: 'Public profile' }),
  ).toBeChecked()

  await page.goto('/app')
  await createProjectAndOpenPrivacy(page, 'EducatorProj')
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()
})

test('the answer is changeable, and changes what new work starts as', async ({
  page,
}) => {
  const email = `switcher-${stamp}@example.com`
  await register(page, email, 'Switch Er')
  await answerAndConfirm(page, email, /^Other/)

  // A project made as "other" is public...
  await createProjectAndOpenPrivacy(page, 'BeforeProj')
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()

  await page.goto('/app/settings?tab=privacy')
  const type = page.getByRole('combobox', { name: 'Account type' })
  await type.selectOption('student')
  await expect(type).toHaveValue('student')

  // ...and stays public: the type chooses defaults for new work, it does
  // not re-scope what already exists.
  await page.goto('/app')
  await createProjectAndOpenPrivacy(page, 'AfterProj')
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.goto('/app')
  await openProjectPrivacyFromHome(page, 'BeforeProj')
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()
})
