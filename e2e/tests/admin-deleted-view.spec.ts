/**
 * E2E soft-deleted content handling against the built app (ADMIN-6): once
 * an admin deletes a lecture and its project, they are gone from the
 * product for their owner — but the admin still opens both from the
 * console, after a confirm that says the opening is audited, and each
 * opening lands in the audit log.
 */
import { test, expect, type Page } from '@playwright/test'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const owner = {
  email: `e2e-deleted-${run}@example.com`,
  displayName: 'Deleted Owner',
}

let slug = ''
let projectId = ''
let deckId = ''
let ownerToken = ''
// A second, untouched course for the project scenario. It needs its own
// lecture: a lecture deleted BEFORE its project keeps the earlier
// tombstone and stays hidden when the project is opened, which is the
// rule this suite relies on elsewhere — so reusing the first course's
// already-deleted lecture would be testing the opposite thing.
let projectId2 = ''

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

test('a user owns a project with one lecture', async ({ request }) => {
  const registered = await request.post('/api/auth/register', {
    data: { ...owner, password },
  })
  expect(registered.status()).toBe(201)
  ownerToken = ((await registered.json()) as { accessToken: string })
    .accessToken
  const headers = { Authorization: `Bearer ${ownerToken}` }

  const project = await request.post('/api/actions/project.create', {
    headers,
    data: { title: 'Doomed Course' },
  })
  expect(project.status()).toBe(200)
  projectId = ((await project.json()) as { id: string }).id

  const deck = await request.post('/api/actions/deck.create', {
    headers,
    data: { projectId, title: 'Doomed Lecture' },
  })
  expect(deck.status()).toBe(200)
  const created = (await deck.json()) as { id: string; permalinkSlug: string }
  deckId = created.id
  slug = created.permalinkSlug
  expect(slug).toBeTruthy()

  const other = await request.post('/api/actions/project.create', {
    headers,
    data: { title: 'Sunk Course' },
  })
  expect(other.status()).toBe(200)
  projectId2 = ((await other.json()) as { id: string }).id
  const otherDeck = await request.post('/api/actions/deck.create', {
    headers,
    data: { projectId: projectId2, title: 'Sunk Lecture' },
  })
  expect(otherDeck.status()).toBe(200)
})

test('the admin deletes the lecture, and it leaves the product', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.goto(`/app/admin/decks/${deckId}`)
  await page.getByRole('button', { name: 'Delete lecture' }).click()
  const dialog = page.getByRole('alertdialog', {
    name: 'Delete this lecture?',
  })
  await dialog.getByRole('button', { name: 'Delete lecture' }).click()
  // The page leaves for the project once the delete has landed
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)

  // Gone for its owner, and for anyone arriving on the permalink
  const asOwner = await page.request.get(`/api/decks/${slug}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  expect(asOwner.status()).toBe(404)
})

test('the admin still opens the deleted lecture, after an audited confirm', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.goto(`/app/admin/decks/${deckId}`)
  await expect(page.getByText('Deleted').first()).toBeVisible()

  await page.getByRole('button', { name: 'View slideshow' }).click()
  const dialog = page.getByRole('alertdialog', {
    name: 'View this deleted lecture?',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'View slideshow' }).click()

  // The viewer opens the tombstoned lecture just as it would a live one
  await expect(page).toHaveURL(/\/d\//)
  await expect(
    page.getByRole('heading', { name: 'Doomed Lecture' }),
  ).toBeVisible()

  // The read audited itself — no client POST involved
  await page.goto('/app/admin/logs')
  await expect(page.getByText('deck.deleted_view').first()).toBeVisible()
})

test('the same holds for a deleted project', async ({ page }) => {
  await ensureSignedIn(page, admin)

  await page.goto(`/app/admin/projects/${projectId2}`)
  await page.getByRole('button', { name: 'Delete project' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete this project?' })
    .getByRole('button', { name: 'Delete project' })
    .click()
  // The page leaves for the owner once the delete has landed; reloading
  // before that would find the project still live and offer the wrong
  // confirm.
  await expect(page).toHaveURL(/\/app\/admin\/users\//)

  await page.goto(`/app/admin/projects/${projectId2}`)
  await expect(page.getByText(/This project is deleted/)).toBeVisible()
  await page.getByRole('button', { name: 'View project' }).click()
  const dialog = page.getByRole('alertdialog', {
    name: 'View this deleted project?',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'View project' }).click()

  // The product project page opens, still listing the lecture that went
  // down with it in the same cascade
  await expect(page).toHaveURL(/\/app\/projects\//)
  await expect(page.getByText('Sunk Course')).toBeVisible()
  await expect(page.getByText('Sunk Lecture')).toBeVisible()

  await page.goto('/app/admin/logs')
  await expect(page.getByText('project.deleted_view').first()).toBeVisible()
})
