/**
 * E2E private-view grant journey against the built app: a user owns a
 * private lecture; the admin cannot open it until the "View private
 * lectures" toggle (off by default) is enabled on the user's admin
 * page; the enablement and the private view both land in the audit log.
 */
import { test, expect, type Page } from '@playwright/test'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const owner = {
  email: `e2e-private-${run}@example.com`,
  displayName: 'Private Owner',
}

let slug = ''

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

test('a user owns a private lecture', async ({ request }) => {
  // Pure API setup: register, then a restricted project with one lecture
  const registered = await request.post('/api/auth/register', {
    data: { ...owner, password },
  })
  expect(registered.status()).toBe(201)
  const { accessToken } = (await registered.json()) as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }

  const project = await request.post('/api/actions/project.create', {
    headers,
    data: { title: 'Secret Course' },
  })
  expect(project.status()).toBe(200)
  const { id: projectId } = (await project.json()) as { id: string }

  const restricted = await request.post('/api/actions/project.setAccess', {
    headers,
    data: { projectId, visibility: 'restricted' },
  })
  expect(restricted.status()).toBe(200)

  const deck = await request.post('/api/actions/deck.create', {
    headers,
    data: { projectId, title: 'Secret Lecture' },
  })
  expect(deck.status()).toBe(200)
  slug = ((await deck.json()) as { permalinkSlug: string }).permalinkSlug
  expect(slug).toBeTruthy()
})

test('the admin needs the audited toggle to view it', async ({ page }) => {
  await ensureSignedIn(page, admin)

  // Off by default: the private lecture is a 404 even for the admin
  await page.goto(`/d/${slug}`)
  await expect(
    page.getByText('This deck does not exist or is private'),
  ).toBeVisible()

  // Enable the toggle on the owner's admin page
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  const toggle = page.getByRole('checkbox', { name: 'View private lectures' })
  await expect(toggle).not.toBeChecked()
  // click, not check(): the control is server-confirmed, so its state
  // flips only after the grant round-trips
  await toggle.click()
  await expect(
    page.getByText(
      'Private lecture viewing enabled — this and each private view are logged.',
    ),
  ).toBeVisible()
  await expect(toggle).toBeChecked()

  // The lecture now opens read-only through its normal viewer link
  await page.getByText('Secret Course').click()
  await page.getByRole('link', { name: 'Secret Lecture' }).click()
  await expect(
    page.getByRole('heading', { name: 'Secret Lecture' }),
  ).toBeVisible()

  // Both the enablement and the view are in the audit log
  await page.goto('/app/admin/logs')
  await expect(
    page.getByText('user.private_view_enabled').first(),
  ).toBeVisible()
  await expect(page.getByText('deck.private_view').first()).toBeVisible()
})
