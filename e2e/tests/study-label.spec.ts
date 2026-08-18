/**
 * E2E for the lecture study label (EVAL-3): the field appears in the
 * lecture-settings modal only for allowlisted admins — the owner never
 * sees it — an admin's edit on another user's lecture persists and lands
 * in the audit log, exactly like any other settings override (ADMIN-5).
 */
import { test, expect, type Page } from './fixtures'
import { verificationTokenFor } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
// The e2e database is never wiped, so the victim is unique per run.
const run = Date.now()
const owner = {
  email: `e2e-study-${run}@example.com`,
  displayName: 'Study Target',
}
const projectTitle = `Study Course ${run}`
const deckTitle = `Study Lecture ${run}`
const label = `B1-SWE-treatment-${run}`

let deckSlug = ''

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

test('a user owns a public project with a lecture', async ({ request }) => {
  const registered = await request.post('/api/auth/register', {
    data: { ...owner, password },
  })
  expect(registered.status()).toBe(201)
  const { accessToken } = (await registered.json()) as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }
  // A public project needs a confirmed address (AUTH-3)
  await request.post('/api/auth/verify-email', {
    data: { token: verificationTokenFor(owner.email) },
  })

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
  deckSlug = ((await deck.json()) as { permalinkSlug: string }).permalinkSlug
})

test('the owner does not see a study label field', async ({ page }) => {
  await ensureSignedIn(page, owner)
  await page.goto(`/d/${deckSlug}`)
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const modal = page.getByRole('dialog', { name: 'Lecture settings' })
  // The modal is fully rendered — the title field proves the General tab is up
  await expect(modal.getByLabel('Lecture title')).toBeVisible()
  await expect(modal.getByLabel('Study label')).toHaveCount(0)
})

test("the admin labels the user's lecture from its settings", async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto(`/d/${deckSlug}`)
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('recorded in the audit log')
  await ask.getByRole('button', { name: 'Edit settings' }).click()
  const modal = page.getByRole('dialog', { name: 'Lecture settings' })
  await expect(modal).toContainText('as an admin')

  const saved = page.waitForResponse(
    res => res.url().includes('deck.setStudyLabel') && res.status() === 200,
  )
  await modal.getByLabel('Study label').fill(label)
  await modal.getByLabel('Study label').blur()
  await saved

  // The value survives a reload, so it really was stored
  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await expect(page.getByLabel('Study label')).toHaveValue(label)
})

test('the label edit is recorded in the audit log', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/logs')
  await expect(page.getByText('deck.settings_update').first()).toBeVisible()
})
