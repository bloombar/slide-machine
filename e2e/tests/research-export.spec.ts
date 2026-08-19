/**
 * The research export end to end (SPEC EVAL-2): the admin reaches the
 * Research section from the admin nav, reads the de-identification
 * caveats, and downloads the zip bundle; a regular user can do none of
 * it — no nav entry, bounced from the URL, refused by the API.
 */
import { test, expect, type Page } from './fixtures'

const password = 'sturdy-passw0rd'
// Must match ADMIN_EMAILS in playwright.config.ts; the account may already
// exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const user = {
  email: `e2e-research-${run}@example.com`,
  displayName: 'Research Rube',
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

test.describe.configure({ mode: 'serial' })

test('a regular user cannot reach the research export', async ({ page }) => {
  await ensureSignedIn(page, user)

  await page.goto('/app/admin/research')
  await expect(page).toHaveURL(/\/app$/)

  // Unauthenticated (page.request carries no bearer token) or authenticated
  // but unlisted — either way the API refuses.
  const api = await page.request.get('/api/admin/research/export')
  expect([401, 403]).toContain(api.status())
})

test('the admin downloads the de-identified bundle from the Research tab', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.goto('/app/admin')
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Research' })
    .click()
  await expect(page).toHaveURL(/\/app\/admin\/research$/)
  await expect(page.getByRole('heading', { name: 'Research' })).toBeVisible()
  // The page must own the caveat: pseudonymous, not anonymous.
  await expect(page.getByText(/Free text is/)).toBeVisible()

  // The button fetches the bundle with the admin's token and hands it to
  // the browser as a dated zip download.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /download bundle/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^research-export-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  // The downloaded bytes are a real, non-empty zip.
  const file = await download.path()
  const { readFileSync } = await import('node:fs')
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
})
