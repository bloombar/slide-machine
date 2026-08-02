/**
 * E2E billing journey (SPEC BILL-2) against the built app and the in-memory
 * billing adapter: the Plan tab, a hosted checkout that lands back in the
 * app, and the provider webhook that is the only thing allowed to actually
 * move the account onto a paid tier.
 *
 * The split matters and is the reason this is an e2e rather than two unit
 * tests: coming back from checkout does not upgrade anybody. The browser
 * returns first and the provider's webhook arrives separately, so the test
 * checks that the app says "being updated" on the way back, and only reads
 * "Pro" once the webhook has been delivered.
 */
import { test, expect, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const password = 'sturdy-passw0rd'
const account = {
  email: `e2e-billing-${Date.now()}@example.com`,
  displayName: 'Billing Tester',
}

/** Signs the account in, creating it on the first test that needs it. Each
 * test gets a fresh browser context, so the session is re-established rather
 * than carried over; the account and its subscription live in the database. */
const ensureSignedIn = async (page: Page) => {
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

/** The signed-in account's id, read the way the app itself reads it. */
const currentUserId = async (page: Page): Promise<string> => {
  const res = await page.request.post('/api/auth/refresh')
  expect(res.ok()).toBe(true)
  return (await res.json()).user.id as string
}

/** Delivers a subscription event as the payment provider would. */
const deliverWebhook = async (page: Page, userId: string, tier: string) => {
  const res = await page.request.post('/api/billing/webhook', {
    data: {
      type: 'subscription.active',
      providerEventId: `evt_${tier}_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      subscription: {
        providerSubscriptionId: `sub_${userId}`,
        billingCustomerId: `cus_${userId}`,
        userId,
        tier,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
      },
    },
  })
  expect(res.ok()).toBe(true)
  expect((await res.json()).applied).toBe(true)
}

test('a new account starts on the free plan with nothing to manage', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/settings?tab=plan')

  await expect(page.getByTestId('billing-panel')).toBeVisible()
  await expect(page.getByText(/free plan — no subscription/i)).toBeVisible()
  // Nothing has ever been billed, so there is no portal to open.
  await expect(
    page.getByRole('button', { name: /Manage billing/i }),
  ).toBeHidden()
})

test('checkout hands off to the provider and returns to the plan tab', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/settings?tab=plan')
  await page.getByRole('button', { name: /Upgrade to Pro/i }).click()

  // The mock adapter has no hosted page, so it "completes" straight back to
  // the success URL the server built — which is how we know that URL is right.
  await expect(page).toHaveURL(/checkout=success/)
  // Scoped to the panel: the header's API health indicator is also a status.
  await expect(
    page.getByTestId('billing-panel').getByRole('status'),
  ).toContainText(/being updated/i)

  // And the plan has *not* moved: the redirect is not the payment. Exact,
  // so this is the tier badge rather than the sentence explaining it.
  await expect(page.getByText('Free', { exact: true })).toBeVisible()
})

test('the provider webhook is what puts the account on the paid tier', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/settings?tab=plan')
  const userId = await currentUserId(page)

  await deliverWebhook(page, userId, 'pro')
  await page.reload()

  await expect(page.getByText('Pro', { exact: true })).toBeVisible()
  // With a billing record behind it, the hosted portal is now reachable.
  await expect(
    page.getByRole('button', { name: /Manage billing/i }),
  ).toBeVisible()
  // And there is one tier left to sell, but no longer a Pro upgrade.
  await expect(
    page.getByRole('button', { name: /Upgrade to Max/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Upgrade to Pro/i }),
  ).toBeHidden()
})

test('the paid plan raises the caps the usage panel reports', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/settings?tab=plan')

  // The same tier drives entitlement, so the usage view moves with it — the
  // point of syncing `planTier` from the subscription rather than reading the
  // provider at every metered call (BILL-3).
  await expect(page.getByTestId('usage-panel')).toBeVisible()
  await expect(page.getByText('Pro', { exact: true })).toBeVisible()
})
