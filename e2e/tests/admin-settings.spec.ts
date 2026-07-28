/**
 * E2E settings editing against the built app (ADMIN-5): the allowlisted
 * admin changes another user's project and lecture settings through the
 * confirm dialog, the values survive a reload, both edits land in the
 * audit log, and an entity the admin owns refuses the edit.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
// The e2e database is never wiped, so the victim is unique per run.
const run = Date.now()
const owner = {
  email: `e2e-settings-${run}@example.com`,
  displayName: 'Settings Target',
}
const projectTitle = `Settings Course ${run}`
const deckTitle = `Settings Lecture ${run}`

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

/** Opens the confirm dialog, checks one listed change, and saves. */
const saveWithConfirm = async (page: Page, change: string) => {
  await page.getByRole('button', { name: 'Save changes' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText(change)).toBeVisible()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Settings saved.')).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('a user owns a project with a lecture', async ({ request }) => {
  // Pure API setup: register, then a public project with one lecture
  const registered = await request.post('/api/auth/register', {
    data: { ...owner, password },
  })
  expect(registered.status()).toBe(201)
  const { accessToken } = (await registered.json()) as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }

  const project = await request.post('/api/actions/project.create', {
    headers,
    data: { title: projectTitle },
  })
  expect(project.status()).toBe(200)
  const { id: projectId } = (await project.json()) as { id: string }

  const deck = await request.post('/api/actions/deck.create', {
    headers,
    data: { projectId, title: deckTitle },
  })
  expect(deck.status()).toBe(200)
})

test("the admin edits another user's project settings", async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: projectTitle }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)

  // Nothing is dirty yet, so there is nothing to save
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled()

  await page.getByLabel('Visibility').selectOption('restricted')
  await saveWithConfirm(page, 'Visibility: Public → Private')

  // The value survives a reload, so it really was stored
  await page.reload()
  await expect(page.getByLabel('Visibility')).toHaveValue('restricted')
})

test("the admin edits another user's lecture settings", async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: projectTitle }).click()
  await page.getByRole('link', { name: deckTitle }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks\//)

  // The lecture still follows its project, so visibility is unset here
  await expect(page.getByLabel('Visibility')).toHaveValue('')

  await page.getByLabel('Visibility').selectOption('public')
  await page.getByLabel('AI freedom').fill('4')
  await saveWithConfirm(
    page,
    "Visibility: Follows the project's settings → Public",
  )

  await page.reload()
  await expect(page.getByLabel('Visibility')).toHaveValue('public')
  await expect(page.getByLabel('AI freedom')).toHaveValue('4')
})

test('both edits are recorded in the audit log', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/logs')
  for (const action of ['deck.settings_update', 'project.settings_update']) {
    await expect(page.getByText(action).first()).toBeVisible()
  }
})

test('a project the admin owns refuses the edit', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await createProject(page, `Admin Own Project ${run}`)
  const projectId = page.url().split('/app/projects/')[1]!

  await page.goto(`/app/admin/projects/${projectId}`)
  await page.getByLabel('Visibility').selectOption('restricted')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Save changes' })
    .click()

  await expect(page.getByRole('alert')).toContainText(
    'Admin accounts cannot be moderated',
  )
  // Nothing was stored: a reload still shows the original visibility
  await page.reload()
  await expect(page.getByLabel('Visibility')).toHaveValue('public')
})
