/**
 * Unit tests for the footer usage badge (BILL-4): the collapsed summary, the
 * panel it opens, and the one rule that is a privacy matter rather than a
 * layout one — a signed-out visitor is shown nothing at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { UsageMetricSummary } from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import UsageBadge from './UsageBadge'
import { mockFetchRoutes } from '../test/fetch-mock'

const user = {
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  locale: 'en',
}

const metric = (
  over: Partial<UsageMetricSummary> = {},
): UsageMetricSummary => ({
  metric: 'aiTokens',
  used: 10,
  cap: 100,
  fraction: 0.1,
  allowance: 'instructor',
  unit: 'tokens',
  gauge: false,
  ...over,
})

const usageBody = (metrics: UsageMetricSummary[], tier = 'free') => ({
  tier,
  period: '2026-08',
  resetAt: '2026-09-01T00:00:00.000Z',
  metrics,
})

/** Renders the badge for a signed-in user unless `signedIn` is false. */
const renderBadge = (
  metrics: UsageMetricSummary[] = [metric()],
  { signedIn = true, tier = 'free' } = {},
) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      signedIn
        ? { status: 200, body: { user, accessToken: 't' } }
        : { status: 401 },
    '/api/actions/user.usage': () => ({
      status: 200,
      body: usageBody(metrics, tier),
    }),
  })
  render(
    <MemoryRouter>
      <AuthProvider>
        <UsageBadge />
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Clicks the badge once its data has arrived — the button stays disabled
 * until then, so an eager click is silently dropped. */
const openPanel = async () => {
  const button = await screen.findByRole('button')
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  return button
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('UsageBadge', () => {
  it('labels the badge with the plan and its standing', async () => {
    renderBadge([metric({ fraction: 0.2 })])

    expect(await screen.findByText('Free plan ok')).toBeInTheDocument()
  })

  it('warns once a metric crosses the threshold', async () => {
    // Said in words, not only in the dot's colour (TECH-11).
    renderBadge([metric({ fraction: 0.85 })])

    expect(await screen.findByText('Free plan near limit')).toBeInTheDocument()
  })

  it('reports a spent allowance louder than an approaching one', async () => {
    // Worst-metric-wins: one exhausted cap is the headline even when the
    // others are fine, because it is why something just refused to happen.
    renderBadge([
      metric({ fraction: 1 }),
      metric({ metric: 'exports', fraction: 0.1 }),
    ])

    expect(
      await screen.findByText('Free plan limit reached'),
    ).toBeInTheDocument()
  })

  it('opens a panel naming each capped service', async () => {
    renderBadge([
      metric({ metric: 'sttMinutes', used: 30, cap: 75, unit: 'minutes' }),
      metric({ metric: 'audienceTtsCharacters', allowance: 'audience' }),
    ])

    await openPanel()

    expect(await screen.findByTestId('usage-panel-popover')).toBeInTheDocument()
    expect(screen.getByText('Recording time')).toBeInTheDocument()
    expect(screen.getByText('30 min of 75 min')).toBeInTheDocument()
    // The two allowances are labelled apart, not merged into one list.
    expect(screen.getByText('Your allowances')).toBeInTheDocument()
    expect(screen.getByText('Your audience')).toBeInTheDocument()
  })

  it('shows when the period resets', async () => {
    renderBadge()

    await openPanel()

    expect(await screen.findByText(/Resets/)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderBadge()
    await openPanel()
    expect(await screen.findByTestId('usage-panel-popover')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByTestId('usage-panel-popover')).toBeNull(),
    )
  })

  it('invites a Max account to get in touch rather than upgrade', async () => {
    renderBadge([metric()], { tier: 'max' })

    await openPanel()

    expect(await screen.findByText(/largest plan/)).toBeInTheDocument()
  })

  it('names whichever plan the account is on', async () => {
    // "ok" answers a different question depending on which plan it is ok for,
    // so the tier travels with the status rather than only inside the panel.
    renderBadge([metric()], { tier: 'pro' })

    expect(await screen.findByText('Pro plan ok')).toBeInTheDocument()
  })

  it('names the plan in the panel too', async () => {
    renderBadge([metric()], { tier: 'max' })

    await openPanel()

    expect(await screen.findByTestId('usage-plan')).toHaveTextContent('Max')
  })

  it('renders nothing at all for a signed-out visitor', async () => {
    // A stranger on a shared lecture must never see the instructor's billing
    // state — and has no usage of their own to report either (BILL-4).
    renderBadge([metric()], { signedIn: false })

    await waitFor(() => expect(screen.queryByTestId('usage-bar')).toBeNull())
  })
})
