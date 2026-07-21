/**
 * E2E admin interface journey against the built app: a regular user
 * never sees the admin entry and is bounced from /app/admin; the
 * allowlisted admin (ADMIN_EMAILS in playwright.config.ts) reaches the
 * user directory from the menu and drills into a user's projects.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const user = { email: `e2e-plain-${run}@example.com`, displayName: 'Plain Jo' }

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

test.describe.configure({ mode: 'serial' })

test('a regular user has no admin entry and is bounced from /app/admin', async ({
  page,
}) => {
  await ensureSignedIn(page, user)
  await createProject(page, 'Admin E2E Project')

  await page.goto('/app')
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toHaveCount(0)

  await page.goto('/app/admin')
  await expect(page).toHaveURL(/\/app$/)
})

test('the allowlisted admin reaches the directory and a user drill-down', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Admin' }).click()
  await expect(page).toHaveURL(/\/app\/admin$/)

  // Newest-first: the account registered by the previous test is on page 1
  await page.getByRole('link', { name: user.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
  await expect(
    page.getByRole('heading', { name: user.displayName }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'View public profile' }),
  ).toBeVisible()

  await page.getByText('Admin E2E Project').click()
  await expect(page.getByText('No lectures.')).toBeVisible()
})
