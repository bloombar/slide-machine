/**
 * E2E for the settings change log against the built app: an ordinary user
 * changes their own account settings and then a project setting, both
 * through the real UI, and the allowlisted admin finds each change on the
 * User Logs page with the right actor, target, and before/after.
 *
 * This is the log's whole point — it records what USERS do to their
 * settings, not only what admins do — so nothing here is an admin edit;
 * that path is covered by admin-settings.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
// The e2e database is never wiped, so the user is unique per run.
const run = Date.now()
const user = {
  email: `e2e-settings-log-${run}@example.com`,
  displayName: 'Settings Logger',
}
const projectTitle = `Logged Course ${run}`

/** Signs the account in, creating it via the API when it doesn't exist
 * yet (registration also sets the session cookie), and lands on /app. */
const ensureSignedIn = async (
  page: Page,
  account: { email: string; displayName: string },
) => {
  const res = await page.request.post('/api/auth/register', {
    data: { ...account, password },
  })
  if (res.status() === 201) {
    await page.goto('/app')
  } else {
    expect(res.status()).toBe(409)
    await page.goto('/login')
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page).toHaveURL(/\/app$/)
}

/** The settings-log row for `entityName`, whatever page size is showing. */
const rowFor = (page: Page, entityName: string) =>
  page.getByRole('row').filter({ hasText: entityName })

test.describe.configure({ mode: 'serial' })

/** Opens a tab of the account settings. Settings is a page with its own URL
 * rather than a modal, so it is navigated to — which is also why a reload no
 * longer loses it. */
const openAccountSettings = async (
  page: Page,
  tab: 'general' | 'privacy' = 'general',
) => {
  await page.goto(`/app/settings?tab=${tab}`)
  await expect(page.getByRole('tab', { selected: true })).toBeVisible()
}

test('a user changes their own account settings', async ({ page }) => {
  await ensureSignedIn(page, user)
  await openAccountSettings(page, 'privacy')

  // Turning the public profile off is a settings change of its own. The
  // checkbox is controlled by the saved value, so it only flips once the
  // action answers — click and wait rather than uncheck().
  const visibilitySaved = page.waitForResponse(
    res =>
      res.url().includes('user.setProfileVisibility') && res.status() === 200,
  )
  await page.getByLabel('Public profile').click()
  await visibilitySaved
  await expect(page.getByLabel('Public profile')).not.toBeChecked()

  const languageSaved = page.waitForResponse(
    res => res.url().includes('user.setLanguage') && res.status() === 200,
  )
  // The lecture language lives on General, beside the interface language
  // (TECH-12) — hence exact, which a substring match on "Language" would
  // pick up as well.
  await openAccountSettings(page, 'general')
  await page.getByLabel('Language', { exact: true }).selectOption('fr')
  await languageSaved

  // The values survive a reload, so they really were stored.
  await page.reload()
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('fr')
  await openAccountSettings(page, 'privacy')
  await expect(page.getByLabel('Public profile')).not.toBeChecked()
})

test('the same user changes a project setting', async ({ page }) => {
  await ensureSignedIn(page, user)
  await createProject(page, projectTitle)

  await page.getByRole('button', { name: 'Project settings' }).click()
  const modal = page.getByRole('dialog', { name: 'Project settings' })
  await expect(modal).toBeVisible()
  const saved = page.waitForResponse(
    res => res.url().includes('project.update') && res.status() === 200,
  )
  await modal.getByLabel('Language').selectOption('es')
  await saved
})

test('the admin finds the account change on the User Logs page', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: 'User Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/admin\/settings-logs$/)

  // Narrowing to accounts also keeps this run's rows on the first page of
  // a log the e2e database never wipes
  await page.getByLabel('Settings kind').selectOption('user')
  // Newest first, so the language change leads — one entry per change
  const account = rowFor(page, user.email).first()
  await expect(account).toBeVisible()
  // Made by the account holder themselves, not an admin
  await expect(account).toContainText('owner')
  await expect(account).toContainText('account')
  await expect(account).toContainText('language')
  // A cleared value reads as "not set", never as null
  await expect(account).toContainText('not set')
  await expect(account).toContainText('fr')
  // The earlier visibility change is its own entry, not folded into this one
  await expect(page.getByText('profileVisibility').first()).toBeVisible()
})

test('the admin narrows the log to project settings', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/settings-logs')
  await page.getByLabel('Settings kind').selectOption('project')

  const project = rowFor(page, projectTitle).first()
  await expect(project).toBeVisible()
  await expect(project).toContainText('project')
  // The field and its before/after, not just that something changed
  await expect(project).toContainText('language')
  await expect(project).toContainText('es')
  // Account settings drop out: profileVisibility exists only on accounts
  await expect(page.getByText('profileVisibility')).toHaveCount(0)
})
