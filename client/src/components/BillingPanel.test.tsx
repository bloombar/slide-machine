/**
 * Unit tests for the account-settings billing panel (BILL-2): what the plan
 * is doing, the way out to the payment provider, and the outcome of a
 * checkout the browser has just come back from.
 *
 * The panel's job is to navigate, not to decide, so what is asserted here is
 * mostly restraint: it only offers the portal once there is something to
 * manage, never claims a plan the server has not confirmed, and no longer
 * sells anything — choosing a plan is the pricing page's job.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { BillingSummary } from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import BillingPanel from './BillingPanel'
import { mockFetchRoutes } from '../test/fetch-mock'

const user = {
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  locale: 'en',
}

const summary = (over: Partial<BillingSummary> = {}): BillingSummary => ({
  tier: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canManageBilling: false,
  purchasableTiers: ['fresh', 'pro', 'max'],
  ...over,
})

/** Renders the panel for a signed-in account, at `entry` so the checkout
 * outcome in the URL can be varied. */
const renderPanel = (
  body: BillingSummary | null = summary(),
  {
    entry = '/app/settings?tab=plan',
    redirect = 'https://pay.test/session',
  } = {},
) => {
  const mocked = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user, accessToken: 't' },
    }),
    '/api/actions/billing.summary': () =>
      body
        ? { status: 200, body }
        : {
            status: 500,
            body: { error: { code: 'server_error', message: 'x' } },
          },
    '/api/actions/billing.portal': () => ({
      status: 200,
      body: { url: redirect },
    }),
  })
  setAccessToken('t')
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>
    </MemoryRouter>,
  )
  return mocked
}

/** window.location.assign, stubbed so a redirect can be asserted rather than
 * attempted — jsdom cannot navigate. */
let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('BillingPanel', () => {
  it('says a free account has no subscription', async () => {
    renderPanel()

    // "No subscription" and "subscription ended" are different facts, and the
    // free tier is the first one.
    expect(
      await screen.findByText(/free plan — no subscription/i),
    ).toBeInTheDocument()
  })

  it('sells nothing — a plan is chosen on the pricing page', async () => {
    renderPanel()

    // Three tiers are on offer and none is advertised here: comparing them
    // needs the table, so settings links out rather than listing buttons.
    await screen.findByText(/free plan — no subscription/i)
    expect(screen.queryByRole('button', { name: /Upgrade/i })).toBeNull()
  })

  it('offers nothing to buy on the largest plan, and says why', async () => {
    renderPanel(summary({ tier: 'max' }))

    expect(await screen.findByText(/largest plan/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull()
  })

  // A complimentary plan (ADMIN-9) is entitlement with no subscription behind
  // it, so both halves matter: what the account has, and that it ends.
  it('explains a complimentary plan and when it reverts', async () => {
    renderPanel(
      summary({
        tier: 'pro',
        planGrant: {
          tier: 'pro',
          expiresAt: '2026-09-30T23:59:59.999Z',
          revertsTo: 'free',
        },
      }),
    )

    const notice = await screen.findByText(/Pro at no charge until/i)
    expect(notice).toHaveTextContent(/returns to Free/i)
    // "You are on the free plan — no subscription" is true of the billing and
    // false of the plan; with a grant in effect it would read as a denial of
    // the very thing the line above just granted.
    expect(screen.queryByText(/free plan — no subscription/i)).toBeNull()
  })

  it('hides the portal until there is a billing record to manage', async () => {
    renderPanel()

    await screen.findByText(/free plan — no subscription/i)
    expect(screen.queryByRole('button', { name: /Manage/i })).toBeNull()
  })

  it('opens the hosted portal once the account has been billed', async () => {
    renderPanel(
      summary({ tier: 'pro', status: 'active', canManageBilling: true }),
    )

    fireEvent.click(await screen.findByRole('button', { name: /Manage/i }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.test/session'),
    )
  })

  it('shows when the plan renews', async () => {
    renderPanel(
      summary({
        tier: 'pro',
        status: 'active',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      }),
    )

    expect(await screen.findByText(/Renews/)).toBeInTheDocument()
  })

  it('says the plan ends rather than renews once it is cancelled', async () => {
    renderPanel(
      summary({
        tier: 'pro',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      }),
    )

    // The subscription is still active, so the date is the same one — but it
    // is the last day of the plan, not the day it renews.
    expect(await screen.findByText(/Ends/)).toBeInTheDocument()
    expect(screen.queryByText(/Renews/)).toBeNull()
  })

  it('raises a failed payment as an alert, since it needs acting on', async () => {
    renderPanel(summary({ tier: 'pro', status: 'past_due' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/payment/i)
  })

  it('acknowledges a completed checkout without claiming the new plan', async () => {
    renderPanel(summary(), { entry: '/app/settings?tab=plan&checkout=success' })

    // The plan changes when the provider's webhook says so, which may be a
    // moment after the browser gets back — so this says "being updated", and
    // the panel still shows the tier the server currently reports.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /being updated/i,
    )
  })

  it('says nothing changed when checkout was abandoned', async () => {
    renderPanel(summary(), {
      entry: '/app/settings?tab=plan&checkout=canceled',
    })

    expect(await screen.findByRole('status')).toHaveTextContent(
      /Nothing has changed/i,
    )
  })

  it('reports a summary it could not load', async () => {
    renderPanel(null)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not load your billing/i,
    )
  })

  it('re-enables the button when the provider could not be reached', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user, accessToken: 't' },
      }),
      '/api/actions/billing.summary': () => ({
        status: 200,
        body: summary({
          tier: 'pro',
          status: 'active',
          canManageBilling: true,
        }),
      }),
      '/api/actions/billing.portal': () => ({
        status: 503,
        body: {
          error: { code: 'billing_unavailable', message: 'busy' },
        },
      }),
    })
    setAccessToken('t')
    render(
      <MemoryRouter initialEntries={['/app/settings?tab=plan']}>
        <AuthProvider>
          <BillingPanel />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Manage/i }))

    // Nothing navigated, so the user is still here and must be able to retry.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not open the billing page/i,
    )
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Manage/i })).toBeEnabled()
  })
})
