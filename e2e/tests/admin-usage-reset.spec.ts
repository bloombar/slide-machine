/**
 * E2E allowance resets against the built app (ADMIN-10): an account spends a
 * metered allowance, an allowlisted admin hands it back from the Service
 * usage panel on that account's console page, and the account's own usage
 * view — the server metering it, not a page repeating a form — says so.
 *
 * The allowance is spent for real rather than written into the database: an
 * exported lecture is the cheapest thing a browser can do that costs a
 * counter, and starting from a genuine spend is what makes the reset's effect
 * something other than zero either way.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
// The e2e database is never wiped, so the target is unique per run.
const run = Date.now()
const owner = {
  email: `e2e-usage-${run}@example.com`,
  displayName: 'Usage Target',
}

/** Signs the account in, creating it when it doesn't exist yet, and lands
 * on /app. */
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

/** What the target account's own usage view reports for one metric — the
 * counter the caps are actually checked against. */
const ownUsage = async (page: Page, metric: string): Promise<number> => {
  const login = await page.request.post('/api/auth/login', {
    data: { email: owner.email, password },
  })
  const { accessToken } = (await login.json()) as { accessToken: string }
  const res = await page.request.post('/api/actions/user.usage', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  })
  const body = (await res.json()) as {
    metrics: { metric: string; used: number }[]
  }
  return body.metrics.find(m => m.metric === metric)!.used
}

/** The target's Service usage panel on its console page. */
const openUsagePanel = async (page: Page) => {
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
  return page.getByTestId('admin-usage-panel')
}

test.describe.configure({ mode: 'serial' })

test('the account spends an allowance', async ({ page }) => {
  await ensureSignedIn(page, owner)
  await createProject(page, 'Usage Reset Project')
  await page
    .getByRole('button', { name: 'Start a new lecture in Usage Reset Project' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Photosynthesis happens in the chloroplasts')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // An export is metered (BILL-3), so this is a real charge against a real
  // cap rather than a counter written by the test.
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Export' }).click()
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PDF' }).click()
  await downloaded

  expect(await ownUsage(page, 'exports')).toBe(1)
})

test('the admin hands the allowance back', async ({ page }) => {
  await ensureSignedIn(page, admin)
  const panel = await openUsagePanel(page)
  await expect(panel.getByTestId('usage-metric-exports')).toBeVisible()

  // Nothing happens on the button alone: the account is not the admin's, so
  // the reset is confirmed first and says what it does not touch.
  await panel.getByRole('button', { name: 'Reset allowances' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(/Stored audio is not reset/)

  const posted = page.waitForResponse(
    res =>
      res.url().includes('/usage/reset') &&
      res.request().method() === 'POST' &&
      res.status() === 200,
  )
  await confirm.getByRole('button', { name: 'Reset allowances' }).click()
  await posted

  // What was cleared, not merely that something was.
  await expect(panel.getByRole('status')).toHaveText(
    'Reset 1 allowance for this period.',
  )

  // The server agrees, on the view the account itself would read.
  expect(await ownUsage(page, 'exports')).toBe(0)
})

test('the reset is in the audit log', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin/logs')

  const row = page
    .getByRole('row')
    .filter({ hasText: 'user.usage_reset' })
    .first()
  await expect(row).toContainText(owner.email)
  await expect(row).toContainText(admin.email)
})
