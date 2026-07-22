/**
 * E2E admin moderation journey against the built app: the allowlisted
 * admin resets a user's password, deletes their project, bans their
 * email (login then fails), unbans it (login works again), deletes the
 * account, and finds every action in the audit log.
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
const newPassword = 'brand-new-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const victim = {
  email: `e2e-victim-${run}@example.com`,
  displayName: 'Moderation Target',
}

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

/** API login attempt through the isolated request fixture — NOT
 * page.request, whose shared cookie jar would replace the admin's
 * refresh session with the probed account's. */
const apiLogin = (request: APIRequestContext, email: string, pw: string) =>
  request.post('/api/auth/login', { data: { email, password: pw } })

test.describe.configure({ mode: 'serial' })

test('the victim account exists with a project', async ({ page }) => {
  await ensureSignedIn(page, victim)
  await createProject(page, 'Doomed Project')
})

test('the admin moderates: password, project, ban, delete, audit', async ({
  page,
  request,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: victim.email }).click()
  await expect(
    page.getByRole('heading', { name: victim.displayName }),
  ).toBeVisible()

  // Reset the password: the old one stops working, the new one works
  await page.getByRole('button', { name: 'Reset password' }).click()
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Set password', exact: true }).click()
  await expect(
    page.getByText('Password updated; all sessions signed out.'),
  ).toBeVisible()
  expect((await apiLogin(request, victim.email, password)).status()).toBe(401)
  expect((await apiLogin(request, victim.email, newPassword)).status()).toBe(
    200,
  )

  // Delete the project after a confirm
  await page
    .getByRole('button', { name: 'Delete project Doomed Project' })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete project' })
    .click()
  await expect(page.getByText('Project deleted.')).toBeVisible()
  await expect(page.getByText('No projects.')).toBeVisible()

  // Ban the email: badge appears and even the new password stops working
  await page.getByRole('button', { name: 'Ban email' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Ban email' })
    .click()
  await expect(
    page.getByText('Email banned; all sessions signed out.'),
  ).toBeVisible()
  await expect(page.getByText('Banned', { exact: true })).toBeVisible()
  expect((await apiLogin(request, victim.email, newPassword)).status()).toBe(
    403,
  )

  // Unban: the ban button flipped to Unban; the badge clears and the
  // password works again
  await page.getByRole('button', { name: 'Unban email' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Unban email' })
    .click()
  await expect(page.getByText('Email unbanned.')).toBeVisible()
  await expect(page.getByText('Banned', { exact: true })).toHaveCount(0)
  expect((await apiLogin(request, victim.email, newPassword)).status()).toBe(
    200,
  )

  // Delete the account: back to the directory, the user is gone
  await page.getByRole('button', { name: 'Delete user' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete user' })
    .click()
  await expect(page).toHaveURL(/\/app\/admin$/)
  await expect(page.getByRole('link', { name: victim.email })).toHaveCount(0)

  // Every action is in the audit log (newest first, so all on page 1)
  await page.goto('/app/admin/logs')
  for (const action of [
    'user.delete',
    'user.unban_email',
    'user.ban_email',
    'project.delete',
    'user.password_reset',
  ]) {
    await expect(page.getByText(action).first()).toBeVisible()
  }
})
