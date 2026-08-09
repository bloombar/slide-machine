/**
 * E2E journey for viewing and recovering soft-deleted content (ADMIN-6)
 * against the built app: the allowlisted admin deletes a user's project,
 * finds it still listed everywhere the console lists live content — the
 * owner's page and the site-wide project directory — badged "Deleted",
 * opens it (which the audit log records as project.deleted_view), confirms
 * the owner can no longer reach it, restores it, and sees the badge clear.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const owner = {
  email: `e2e-recover-${run}@example.com`,
  displayName: 'Recovery Owner',
}
const PROJECT = `Recoverable ${run}`

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

/** Opens the owner's admin page from the user directory. */
const openOwnerPage = async (page: Page) => {
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(
    page.getByRole('heading', { name: owner.displayName }),
  ).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('the owner has a project to lose', async ({ page }) => {
  await ensureSignedIn(page, owner)
  await createProject(page, PROJECT)
  await page.goto('/app')
  await expect(page.getByText(PROJECT)).toBeVisible()
})

test('the admin deletes the project and still sees it, badged', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await openOwnerPage(page)

  await page.getByRole('button', { name: `Delete project ${PROJECT}` }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete project' })
    .click()
  await expect(
    page.getByText('Project deleted; you can restore it from this page.'),
  ).toBeVisible()

  // Still listed on the owner's page, badged, with a restore in place of
  // the delete it used to offer.
  await expect(page.getByText('Deleted', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: `Restore project ${PROJECT}` }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: `Delete project ${PROJECT}` }),
  ).toHaveCount(0)

  // And still listed in the site-wide project directory, badged there too.
  await page.goto('/app/admin/projects')
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: PROJECT }) })
  await expect(row.getByText('Deleted', { exact: true })).toBeVisible()
})

test('opening the deleted project is audited, and the owner cannot reach it', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/projects')
  await page.getByRole('link', { name: PROJECT }).click()

  // The project's own admin page opens, badged, with recovery instead of
  // the danger zone. It still opens in the product — read-only, behind a
  // confirm, and audited (ADMIN-6); admin-deleted-view.spec.ts walks that.
  await expect(page.getByRole('heading', { name: PROJECT })).toBeVisible()
  await expect(page.getByText('Deleted', { exact: true })).toBeVisible()
  await expect(page.getByText(/This project is deleted/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Restore project' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'View project' })).toBeVisible()

  // The opening itself is an access to deleted content, so it is logged.
  await page.goto('/app/admin/logs')
  await expect(page.getByText('project.deleted_view').first()).toBeVisible()
})

test('the owner no longer sees the deleted project', async ({ page }) => {
  await ensureSignedIn(page, owner)
  await page.goto('/app')
  await expect(page.getByText(PROJECT)).toHaveCount(0)
})

test('the admin restores the project and the badge clears', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await openOwnerPage(page)

  await page.getByRole('button', { name: `Restore project ${PROJECT}` }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Restore project' })
    .click()
  await expect(page.getByText('Project restored.')).toBeVisible()
  await expect(page.getByText('Deleted', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: `Delete project ${PROJECT}` }),
  ).toBeVisible()

  // The restore is audited too.
  await page.goto('/app/admin/logs')
  await expect(page.getByText('project.restore').first()).toBeVisible()
})

test('the owner sees the restored project again', async ({ page }) => {
  await ensureSignedIn(page, owner)
  await page.goto('/app')
  await expect(page.getByText(PROJECT)).toBeVisible()
})
