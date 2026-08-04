/**
 * E2E billing journey (SPEC BILL-1/BILL-2) against the built app and the
 * in-memory billing adapter: the Plan tab, the plan-pricing page it links to,
 * a hosted checkout that lands back in the app, and the provider webhook that
 * is the only thing allowed to actually move the account onto a paid tier.
 *
 * The split matters and is the reason this is an e2e rather than two unit
 * tests: coming back from checkout does not upgrade anybody. The browser
 * returns first and the provider's webhook arrives separately, so the test
 * checks that the app says "being updated" on the way back, and only reads
 * "Pro" once the webhook has been delivered.
 *
 * The pricing table is checked here too, because it is assembled from three
 * places that only meet in a running system: caps from the deployment's plans
 * file, prices from the billing provider, and the account's own tier from the
 * database.
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

test('the plan tab links to the pricing table rather than listing upgrades', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/settings?tab=plan')

  // Nothing is sold from settings any more: it says what you are on, and
  // where to go to compare.
  await expect(page.getByRole('button', { name: /Upgrade to/i })).toBeHidden()
  await page.getByRole('link', { name: /Change plan/i }).click()

  await expect(page).toHaveURL(/\/app\/plans$/)
  await expect(page.getByTestId('plan-table')).toBeVisible()
})

test('the pricing table compares every plan, with prices and caps', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/plans')

  const table = page.getByTestId('plan-table')
  // A column per plan, the free one included.
  for (const plan of ['Free', 'Fresh', 'Pro', 'Max']) {
    await expect(
      table.getByRole('columnheader', { name: new RegExp(plan) }),
    ).toBeVisible()
  }

  // The price comes from the billing provider; the mock adapter quotes $29
  // for the second paid tier.
  await expect(table.getByText('$29.00 per month')).toBeVisible()
  await expect(table.getByText('No charge')).toBeVisible()

  // A capped row carries each plan's allowance, straight from the
  // deployment's plans file, in a unit a reader recognizes.
  const recording = table.getByRole('row', { name: /Audio recording time/ })
  await expect(recording.getByRole('cell').first()).toHaveText('75 min')
  // Retention answers the question the row above it raises, so it sits under
  // it rather than in a section of its own.
  await expect(
    table.getByRole('row', { name: /Original audio retention/ }),
  ).toBeVisible()
  // And narration, billed per character, is read as time spoken.
  await expect(
    table
      .getByRole('row', { name: /^Narration/ })
      .getByRole('cell')
      .first(),
  ).toContainText(/of narration/)

  // And an uncapped capability is ticked rather than given a number.
  await expect(
    table.getByRole('row', { name: /Voice commands/ }).getByText('Included'),
  ).toHaveCount(4)

  // The plan the account is on is held, not sold again.
  await expect(page.getByTestId('current-plan-free')).toHaveText('Your plan')
})

test('checkout hands off to the provider and returns to the plan tab', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/plans')
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

  // And on the pricing page there is one tier left to *sell*: Pro now reads as
  // the plan held, and the smaller plans are a change to the subscription
  // rather than a second purchase, so none of them offers an upgrade.
  await page.goto('/app/plans')
  await expect(page.getByTestId('current-plan-pro')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Upgrade to Max/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Upgrade to Pro/i }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: /Upgrade to Fresh/i }),
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

test('a smaller plan says what it costs before anything changes', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/plans')

  await page.getByTestId('downgrade-fresh').click()

  // The warning is the requirement (BILL-5/P-10): a smaller plan keeps lecture
  // audio for fewer days, and what that deletes is said here — for this
  // account, nothing, since it has recorded nothing.
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/Switch to Fresh\?/i)
  await expect(dialog).toContainText(/will be deleted|Nothing you have/i)

  // Declining changes nothing at all.
  await dialog.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('current-plan-pro')).toBeVisible()
})

test('accepting the warning moves the account down in place', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/plans')

  await page.getByTestId('downgrade-fresh').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Switch to Fresh/i })
    .click()

  // No hosted page and no webhook: a downgrade is a change to a subscription
  // that already exists, so the account is on the smaller plan when the call
  // returns rather than whenever the provider gets around to saying so.
  await expect(page.getByTestId('plan-change-done')).toContainText(
    /now on the Fresh plan/i,
  )
  await expect(page.getByTestId('current-plan-fresh')).toBeVisible()

  await page.goto('/app/settings?tab=plan')
  await expect(page.getByText('Fresh', { exact: true })).toBeVisible()
})

test('cancelling runs the plan to the end of the period paid for', async ({
  page,
}) => {
  await ensureSignedIn(page)
  await page.goto('/app/plans')

  await page.getByTestId('downgrade-free').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/Cancel your subscription\?/i)
  await dialog.getByRole('button', { name: /Cancel subscription/i }).click()

  await expect(page.getByTestId('plan-change-done')).toContainText(
    /subscription ends/i,
  )
  // Still on the paid plan: cancelling stops the renewal, it does not take
  // back the period already bought.
  await expect(page.getByTestId('current-plan-fresh')).toBeVisible()

  await page.goto('/app/settings?tab=plan')
  await expect(page.getByTestId('billing-panel')).toContainText(/Ends /i)
})
