/**
 * Session telemetry end to end (SPEC EVAL-1): a streamed lecture session
 * leaves an append-only telemetry record, and the admin can see it — the
 * session row on the telemetry overview, and the same session on the
 * lecture's own admin page. Runs under 'chromium-stt' (mock STT server +
 * fake audio), the same rig that proves the capture path itself.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
const run = Date.now()
const speaker = {
  email: `telemetry-speaker-${run}@example.com`,
  displayName: 'Telemetry Speaker',
}
// Must match ADMIN_EMAILS in playwright.config.ts; the account may already
// exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }

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

test('a streamed session leaves a telemetry record the admin can read', async ({
  page,
  browser,
}) => {
  // — The speaker runs a short live session and stops it deliberately. —
  await ensureSignedIn(page, speaker)
  await createProject(page, 'Telemetry 101')
  await page
    .getByRole('button', { name: 'Start a new lecture in Telemetry 101' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // The streamed phrase proves capture ran end to end before we stop.
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis Basics' }),
  ).toBeVisible({ timeout: 15_000 })
  await page
    .getByRole('button', { name: 'Live session', pressed: true })
    .click()

  // — The admin finds the session, stopped, on the overview… —
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await ensureSignedIn(adminPage, admin)
  await adminPage.goto('/app/admin/telemetry')
  // The e2e lecture stays untitled (the mock generator titles slides, not
  // decks), so the row is recognizable by the untitled label and the clean
  // stop the speaker just performed.
  const row = adminPage
    .getByRole('row')
    .filter({ hasText: 'Stopped' })
    .filter({ hasText: 'Untitled lecture' })
    .first()
  await expect(row).toBeVisible({ timeout: 10_000 })

  // — …and the same session on the lecture's own admin page. —
  await row.getByRole('link').first().click()
  await expect(adminPage).toHaveURL(/\/app\/admin\/decks\//)
  const panel = adminPage.getByTestId('telemetry-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Stopped')).toBeVisible()
  await adminContext.close()
})
