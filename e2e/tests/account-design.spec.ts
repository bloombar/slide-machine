/**
 * The account's default design end to end (TMPL-24).
 *
 * The cascade this walks: the account starts on NYU Elegant without ever
 * having chosen it, a choice made in Account settings → Design is what new
 * projects start from, and a lecture created in such a project starts from
 * the project. Each level copies the one above at creation and keeps its own
 * copy, so nothing already made is rewritten.
 */
import { test, expect } from './fixtures'
import { createProject, openProjectSettings } from './helpers'

const email = `adesign-${Date.now()}@example.com`

test('the account default design cascades to new projects and lectures', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Designer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // A brand-new account has chosen nothing, and the tab says what it will
  // get rather than showing an empty picker.
  await page.goto('/app/settings?tab=design')
  await expect(
    page.getByRole('radio', { name: /nyu elegant/i }),
  ).toHaveAttribute('aria-checked', 'true')

  // The design is exportable from here, the same three destinations the
  // lecture and project Design tabs offer.
  await expect(page.getByRole('button', { name: 'As YAML' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'As PowerPoint' }),
  ).toBeVisible()

  // A project made before the choice keeps the default it was given, and
  // says so from its own Design tab. createProject leaves the browser on the
  // new project's page, where its kebab is.
  await page.goto('/app')
  await createProject(page, 'BeforeProj')
  await openProjectSettings(page, 'BeforeProj')
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(
    page.getByRole('radio', { name: /nyu elegant/i }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Choose Midnight for the account.
  await page.goto('/app/settings?tab=design')
  await page.getByRole('radio', { name: /midnight/i }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // It survives a reload, so it was saved rather than only shown.
  await page.reload()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // A project created after the choice starts on it.
  await page.goto('/app')
  await createProject(page, 'AfterProj')
  await openProjectSettings(page, 'AfterProj')
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // And a lecture started in the new project inherits the project's.
  await page
    .getByRole('button', { name: 'Start a new lecture in AfterProj' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  // Dismiss the pre-lecture seed dialog before reaching settings
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // The earlier project was not rewritten by the later choice: inheritance
  // happens once, at creation.
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'BeforeProj', exact: true }).click()
  await openProjectSettings(page, 'BeforeProj')
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(
    page.getByRole('radio', { name: /nyu elegant/i }),
  ).toHaveAttribute('aria-checked', 'true')
})
