/**
 * E2E settings editing against the built app (ADMIN-5): the allowlisted
 * admin edits another user's account, project, and lecture settings in
 * the product view, in the owner's own settings modal — each confirmed
 * once, banner shown, values surviving a reload, and every edit landing
 * in the audit log. The console's user, project, and lecture pages carry
 * no settings editor of their own.
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

/** Opens the settings modal from the icon, through the admin confirm. */
const openSettingsAsAdmin = async (page: Page, label: string) => {
  await page.getByRole('button', { name: label }).click()
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('recorded in the audit log')
  await ask.getByRole('button', { name: 'Edit settings' }).click()
  const modal = page.getByRole('dialog', { name: label })
  await expect(modal).toContainText('as an admin')
  return modal
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

test('the admin console has no settings editor of its own', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)

  // The user page lists the account read-only and points at the profile
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(page.getByLabel('Display name')).toHaveCount(0)
  await expect(page.getByText('Settings are edited on the user')).toBeVisible()

  await page.getByRole('link', { name: projectTitle }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)

  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(
    page.getByText('Settings are edited in the project'),
  ).toBeVisible()

  await page.getByRole('link', { name: deckTitle }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks\//)
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(
    page.getByText('Settings are edited in the lecture'),
  ).toBeVisible()
})

test("the admin edits another user's account settings", async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)

  // The account's settings live on the owner's own profile page
  await page.getByRole('link', { name: 'View public profile' }).click()
  await expect(page).toHaveURL(/\/u\//)

  const modal = await openSettingsAsAdmin(page, 'Settings')
  await expect(modal).toContainText(owner.email)
  // Signing out would end the admin's own session, so it is not offered
  await expect(modal.getByRole('button', { name: /sign out/i })).toHaveCount(0)

  const saved = page.waitForResponse(
    res =>
      /\/api\/admin\/users\/[a-f0-9]+$/.test(res.url()) &&
      res.request().method() === 'PATCH' &&
      res.status() === 204,
  )
  await modal.getByLabel('Language').selectOption('fr')
  await saved

  // The value survives a reload, so it really was stored
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await expect(page.getByLabel('Language')).toHaveValue('fr')

  // …and the console lists it, read-only
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page.getByText('Français (French)')).toBeVisible()
})

test("the admin edits another user's project settings", async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: projectTitle }).click()

  // Straight into the product view — the project is public, so no
  // private-view confirmation stands in the way
  await page.getByRole('button', { name: 'View project' }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)

  const modal = await openSettingsAsAdmin(page, 'Project settings')
  // Seed material is the owner's; the settings around it are editable
  await expect(modal.getByText('Seed material')).toHaveCount(0)
  const saved = page.waitForResponse(
    res => res.url().includes('project.update') && res.status() === 200,
  )
  await modal.getByLabel('Language').selectOption('fr')
  await saved

  // The value survives a reload, so it really was stored
  await page.reload()
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await expect(page.getByLabel('Language')).toHaveValue('fr')
})

test("the admin edits another user's lecture settings", async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await page.getByRole('link', { name: projectTitle }).click()
  await page.getByRole('link', { name: deckTitle }).click()
  await page.getByRole('button', { name: 'View slideshow' }).click()
  await expect(page).toHaveURL(/\/d\//)

  const modal = await openSettingsAsAdmin(page, 'Lecture settings')
  // Quiz and Export act through the admin's own Google account
  await expect(modal.getByRole('tab', { name: 'Quiz' })).toHaveCount(0)
  // The slider debounces, so wait for the save it eventually sends
  const saved = page.waitForResponse(
    res =>
      res.url().includes('deck.setGenerationFreedom') && res.status() === 200,
  )
  await modal.getByLabel('AI freedom').fill('4')
  await saved

  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await expect(page.getByLabel('AI freedom')).toHaveValue('4')
})

test('every edit is recorded in the audit log', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/logs')
  for (const action of [
    'deck.settings_update',
    'project.settings_update',
    'user.settings_update',
  ]) {
    await expect(page.getByText(action).first()).toBeVisible()
  }
})

test('the admin edits their own project without the admin path', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await createProject(page, `Admin Own Project ${run}`)

  await page.getByRole('button', { name: 'Project settings' }).click()
  // Their own project: no confirmation, no banner, full settings
  const modal = page.getByRole('dialog', { name: 'Project settings' })
  await expect(modal).toBeVisible()
  await expect(modal).not.toContainText('as an admin')
  await expect(
    modal.getByRole('heading', { name: 'Seed material' }),
  ).toBeVisible()
})
