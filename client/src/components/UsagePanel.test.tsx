/**
 * Unit tests for the account-settings usage panel (BILL-4): every metric with
 * its cap, the reset date, and the instructor and audience allowances kept
 * visibly apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UsageMetricSummary } from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import UsagePanel from './UsagePanel'
import { mockFetchRoutes } from '../test/fetch-mock'

/** The signed-in account the panel's notification toggle reads (BILL-8). */
const user = {
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  notifyCapWarnings: true,
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

const renderPanel = (
  metrics: UsageMetricSummary[] = [metric()],
  { status = 200, tier = 'free' } = {},
) => {
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user, accessToken: 't' },
    }),
    '/api/actions/user.setCapWarnings': () => ({
      status: 200,
      body: { ...user, notifyCapWarnings: false },
    }),
    '/api/actions/user.usage': () => ({
      status,
      body:
        status === 200
          ? {
              tier,
              period: '2026-08',
              resetAt: '2026-09-01T00:00:00.000Z',
              metrics,
            }
          : { error: { code: 'server_error', message: 'no' } },
    }),
  })
  render(
    <AuthProvider>
      <UsagePanel />
    </AuthProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('UsagePanel', () => {
  it('lists a metric against its cap in plain language', async () => {
    renderPanel([
      metric({
        metric: 'ttsCharacters',
        used: 12_000,
        cap: 60_000,
        unit: 'characters',
      }),
    ])

    // Named "Narration", not `ttsCharacters`: the identifier is a fact about
    // our database, not about the reader's afternoon.
    expect(await screen.findByText('Narration')).toBeInTheDocument()
    expect(screen.getByText('12,000 of 60,000')).toBeInTheDocument()
  })

  it('shows an unlimited metric without inventing a bound', async () => {
    renderPanel([metric({ cap: null, fraction: null, used: 4200 })])

    expect(await screen.findByText('4,200 used')).toBeInTheDocument()
    // No bar: there is no proportion of an unbounded allowance.
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('separates the audience allowances from the instructor’s', async () => {
    renderPanel([
      metric({ metric: 'sttMinutes' }),
      metric({ metric: 'audienceTtsCharacters', allowance: 'audience' }),
    ])

    expect(await screen.findByText('Your allowances')).toBeInTheDocument()
    expect(screen.getByText('Your audience')).toBeInTheDocument()
    expect(screen.getByText('Narration for viewers')).toBeInTheDocument()
  })

  it('says when the period resets', async () => {
    renderPanel()

    expect(await screen.findByText(/Resets/)).toBeInTheDocument()
  })

  it('surfaces a failure here, unlike the home notice', async () => {
    // Someone who opened their settings to look at usage is owed an answer.
    renderPanel([], { status: 500 })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your usage',
    )
  })

  it('offers to silence the early warning, and says what stays on', async () => {
    // BILL-8: only the advisory email is switchable, and the panel says so
    // rather than leaving the user to find out by missing something.
    renderPanel()

    const toggle = await screen.findByRole('checkbox', {
      name: /Email me before I run out/,
    })
    expect(toggle).toBeChecked()
    expect(
      screen.getByText(/limit that has actually been reached are always sent/i),
    ).toBeInTheDocument()

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('does not offer an upgrade to the largest plan', async () => {
    renderPanel([metric()], { tier: 'max' })

    expect(await screen.findByText(/largest plan/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Upgrading/)).toBeNull())
  })
})
