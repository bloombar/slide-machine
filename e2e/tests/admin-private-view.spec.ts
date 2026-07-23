/**
 * E2E private-lecture handling against the built app: the admin can
 * always open a private lecture directly in the viewer, but the admin
 * project page lists private lectures only after the audited "Show
 * private lectures" toggle (off by default) is enabled; the enablement
 * lands in the audit log.
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

test('the viewer always opens for the admin; the listing needs the toggle', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // Direct viewer access needs no toggle — admins always get read-only
  await page.goto(`/d/${slug}`)
  await expect(
    page.getByRole('heading', { name: 'Secret Lecture' }),
  ).toBeVisible()

  // The user's admin page links the project to its own admin page,
  // where the private lecture is hidden by default
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: 'Secret Course' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)
  await expect(page.getByText('No lectures.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Secret Lecture' })).toHaveCount(
    0,
  )

  // Enabling the audited toggle reveals it
  const toggle = page.getByRole('checkbox', { name: 'Show private lectures' })
  await expect(toggle).not.toBeChecked()
  // click, not check(): the control is server-confirmed, so its state
  // flips only after the toggle round-trips
  await toggle.click()
  await expect(
    page.getByText('Private lectures shown — this is logged.'),
  ).toBeVisible()
  await expect(toggle).toBeChecked()

  // The refetched list links the lecture to its own admin page, which
  // links on to the live slideshow
  await page.getByRole('link', { name: 'Secret Lecture' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks\//)
  await page.getByRole('link', { name: 'View slideshow' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await expect(
    page.getByRole('heading', { name: 'Secret Lecture' }),
  ).toBeVisible()

  // The enablement is in the audit log
  await page.goto('/app/admin/logs')
  await expect(
    page.getByText('user.private_view_enabled').first(),
  ).toBeVisible()
})
