/**
 * The admin CSV exports end to end (SPEC BILL-7 cost ledger, EVAL-1 session
 * telemetry): the Export CSV button on each page downloads the file with the
 * admin's Bearer token. A plain link could not send it, and the admin API
 * answered 401 — so these assert a real download whose first line is the
 * CSV header row.
 */
import { readFileSync } from 'node:fs'
import { test, expect, type Page } from './fixtures'

const password = 'sturdy-passw0rd'
// Must match ADMIN_EMAILS in playwright.config.ts; the account may already
// exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }

const ensureAdminSignedIn = async (page: Page) => {
  const res = await page.request.post('/api/auth/register', {
    data: { ...admin, password },
  })
  if (res.status() === 201) {
    await page.goto('/app')
  } else {
    expect(res.status()).toBe(409)
    await page.goto('/login')
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page).toHaveURL(/\/app$/)
}

const cases = [
  {
    page: 'cost',
    path: '/app/admin/cost',
    file: /^cost-ledger-\d{4}-\d{2}-\d{2}\.csv$/,
    header: 'occurredAt,payerId,',
  },
  {
    page: 'telemetry',
    path: '/app/admin/telemetry',
    file: /^session-telemetry-\d{4}-\d{2}-\d{2}\.csv$/,
    header: 'sessionId,deckId,',
  },
]

for (const c of cases) {
  test(`the admin downloads the ${c.page} CSV from its page`, async ({
    page,
  }) => {
    await ensureAdminSignedIn(page)
    await page.goto(c.path)

    // The button is a fetch with the token, not a link.
    const button = page.getByRole('button', { name: 'Export CSV' })
    await expect(button).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await button.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(c.file)
    const text = readFileSync(await download.path(), 'utf8')
    expect(text.startsWith(c.header)).toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}
