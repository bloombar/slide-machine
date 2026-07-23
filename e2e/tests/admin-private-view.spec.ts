/**
 * E2E private-lecture handling against the built app: the admin can
 * always open a private lecture directly in the viewer, and the admin
 * project page lists private lectures with no toggle. Opening a private
 * project in the product view is confirmed and lands in the audit log.
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

test('the viewer always opens for the admin; the listing shows private lectures', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // Direct viewer access needs no toggle — admins always get read-only
  await page.goto(`/d/${slug}`)
  await expect(
    page.getByRole('heading', { name: 'Secret Lecture' }),
  ).toBeVisible()

  // The user's admin page links the project to its own admin page,
  // where the private lecture is listed with no toggle needed
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: 'Secret Course' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)

  // The listed lecture links to its own admin page, which links on to
  // the live slideshow
  await page.getByRole('link', { name: 'Secret Lecture' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks\//)
  await page.getByRole('link', { name: 'View slideshow' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await expect(
    page.getByRole('heading', { name: 'Secret Lecture' }),
  ).toBeVisible()
})

test('View project opens a private project after a logged confirm', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // Open the private project's admin page
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: 'Secret Course' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)

  // View project → private projects require a confirm that warns it is logged
  await page.getByRole('button', { name: 'View project' }).click()
  const dialog = page.getByRole('alertdialog', {
    name: 'View this private project?',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'View project' }).click()

  // The admin read bypass opens the real project page and lists its lectures
  await expect(page).toHaveURL(/\/app\/projects\//)
  await expect(page.getByText('Secret Course')).toBeVisible()
  await expect(page.getByText('Secret Lecture')).toBeVisible()

  // The private view is recorded in the audit log
  await page.goto('/app/admin/logs')
  await expect(page.getByText('project.private_view').first()).toBeVisible()
})
