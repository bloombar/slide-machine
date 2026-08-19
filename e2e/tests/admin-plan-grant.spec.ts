/**
 * E2E complimentary plan grants against the built app (ADMIN-9): an
 * allowlisted admin puts another account on a larger plan at no charge, from
 * the Plan tab of that account's settings — the same page ADMIN-5 sends them
 * to for everything else about the account — or straight from the account's
 * admin page, which carries the same editor.
 *
 * What is proved end to end is the pair of facts the feature rests on: the
 * account really is on the granted plan afterwards (its own usage view says
 * so, which is the server metering it, not the page repeating a form), and
 * ending the grant really does put it back where it was.
 */
import { test, expect, type Page } from './fixtures'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
// The e2e database is never wiped, so the target is unique per run.
const run = Date.now()
const owner = {
  email: `e2e-plan-${run}@example.com`,
  displayName: 'Plan Target',
}

/** A date a month out, as the picker's `YYYY-MM-DD`. */
const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10)

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

/** Opens the target's account settings as an admin, past the ADMIN-5
 * confirmation, on the Plan tab. */
const openPlanTabAsAdmin = async (page: Page) => {
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
  await page.getByRole('link', { name: 'View public profile' }).click()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await page.getByRole('tab', { name: 'Plan & Usage' }).click()
  return page.getByRole('main')
}

test.describe.configure({ mode: 'serial' })

test('an account starts on the free plan', async ({ request }) => {
  const registered = await request.post('/api/auth/register', {
    data: { ...owner, password },
  })
  expect(registered.status()).toBe(201)
  const { accessToken } = (await registered.json()) as { accessToken: string }

  const summary = await request.post('/api/actions/billing.summary', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  })
  expect((await summary.json()).tier).toBe('free')
})

test('the admin grants a complimentary plan', async ({ page }) => {
  await ensureSignedIn(page, admin)
  const settings = await openPlanTabAsAdmin(page)

  await expect(settings.getByText('Complimentary plan')).toBeVisible()
  const granted = page.waitForResponse(
    res =>
      res.url().includes('/plan-grant') &&
      res.request().method() === 'PUT' &&
      res.status() === 204,
  )
  // By role: the tab panel is itself labelled "Plan", so a plain label
  // lookup would match the panel as well as the select inside it.
  await settings.getByRole('combobox', { name: 'Plan' }).selectOption('pro')
  await settings.getByLabel('Last day').fill(nextMonth)
  await settings.getByRole('button', { name: 'Grant plan' }).click()
  await granted

  // The page re-reads rather than predicting: what it shows is the tier the
  // server decided, with the grant behind it named.
  await expect(settings.getByTestId('plan-tier')).toHaveText('Pro')
  await expect(settings.getByText(/Complimentary Pro until/)).toBeVisible()
  await expect(settings.getByText(/back to Free/)).toBeVisible()
})

test('the account is really on the granted plan', async ({ page, request }) => {
  // Signing in as the target: what its *own* views say is the test, since
  // those read the tier the server meters it against.
  await ensureSignedIn(page, owner)
  const login = await request.post('/api/auth/login', {
    data: { email: owner.email, password },
  })
  const { accessToken } = (await login.json()) as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }

  const usage = await request.post('/api/actions/user.usage', {
    headers,
    data: {},
  })
  expect((await usage.json()).tier).toBe('pro')

  // Entitlement without a bill: nothing was subscribed and nothing is owed.
  const summary = await request.post('/api/actions/billing.summary', {
    headers,
    data: {},
  })
  const body = await summary.json()
  expect(body.tier).toBe('pro')
  expect(body.status).toBeNull()
  expect(body.planGrant.revertsTo).toBe('free')

  // And the account is told, on the page it would look at.
  await page.goto('/app/settings?tab=plan')
  await expect(page.getByText(/Pro at no charge until/)).toBeVisible()
})

test('the console shows the grant beside what the account pays for', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()

  await expect(
    page.getByText(/pro — complimentary until .*, then free/i),
  ).toBeVisible()
})

test('ending the grant puts the account back', async ({ page, request }) => {
  await ensureSignedIn(page, admin)
  const settings = await openPlanTabAsAdmin(page)

  const revoked = page.waitForResponse(
    res =>
      res.url().includes('/plan-grant') &&
      res.request().method() === 'DELETE' &&
      res.status() === 204,
  )
  await settings.getByRole('button', { name: 'End now' }).click()
  await revoked

  await expect(settings.getByTestId('plan-tier')).toHaveText('Free')
  await expect(settings.getByText(/Complimentary Pro until/)).toHaveCount(0)

  const login = await request.post('/api/auth/login', {
    data: { email: owner.email, password },
  })
  const { accessToken } = (await login.json()) as { accessToken: string }
  const summary = await request.post('/api/actions/billing.summary', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {},
  })
  const body = await summary.json()
  expect(body.tier).toBe('free')
  expect(body.planGrant).toBeUndefined()
})

test('the admin user page carries the same grant editor', async ({ page }) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')
  await page.getByRole('link', { name: owner.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)

  const main = page.getByRole('main')
  await expect(main.getByText('Complimentary plan')).toBeVisible()
  const granted = page.waitForResponse(
    res =>
      res.url().includes('/plan-grant') &&
      res.request().method() === 'PUT' &&
      res.status() === 204,
  )
  await main.getByRole('combobox', { name: 'Plan' }).selectOption('pro')
  await main.getByLabel('Last day').fill(nextMonth)
  await main.getByRole('button', { name: 'Grant plan' }).click()
  await granted

  // The Plan row re-reads what the server decided, grant named beside it.
  await expect(
    main.getByText(/pro — complimentary until .*, then free/i),
  ).toBeVisible()

  // And the same page ends it, landing the account back where it pays.
  const revoked = page.waitForResponse(
    res =>
      res.url().includes('/plan-grant') &&
      res.request().method() === 'DELETE' &&
      res.status() === 204,
  )
  await main.getByRole('button', { name: 'End now' }).click()
  await revoked
  await expect(main.getByText(/complimentary until/i)).toHaveCount(0)
})
