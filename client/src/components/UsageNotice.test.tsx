/**
 * Unit tests for the home-page usage notice (BILL-4). Its defining behaviour
 * is when it says *nothing*: a banner that is always there is one nobody
 * reads, and then the one time a number matters it is missed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { UsageMetricSummary } from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import UsageNotice from './UsageNotice'
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

const renderNotice = (
  metrics: UsageMetricSummary[],
  { usageStatus = 200, tier = 'free' } = {},
) => {
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user, accessToken: 't' },
    }),
    '/api/actions/user.usage': () => ({
      status: usageStatus,
      body:
        usageStatus === 200
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
    <MemoryRouter>
      <AuthProvider>
        <UsageNotice />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('UsageNotice', () => {
  it('stays silent while everything is comfortable', async () => {
    renderNotice([
      metric({ fraction: 0.3 }),
      metric({ metric: 'exports', fraction: 0 }),
    ])

    await waitFor(() => expect(screen.queryByTestId('usage-notice')).toBeNull())
  })

  it('warns about only the metrics that are close', async () => {
    renderNotice([
      metric({ metric: 'sttMinutes', fraction: 0.9, unit: 'minutes' }),
      metric({ metric: 'exports', fraction: 0.2 }),
    ])

    expect(await screen.findByTestId('usage-notice')).toBeInTheDocument()
    expect(screen.getByText('Audio recording time')).toBeInTheDocument()
    // The comfortable metric is not listed: the point is what needs attention.
    expect(screen.queryByText('Exports')).toBeNull()
  })

  it('reads differently once a limit is actually reached', async () => {
    renderNotice([metric({ fraction: 1 })])

    expect(
      await screen.findByText("You have reached one of your plan's limits"),
    ).toBeInTheDocument()
  })

  it('offers Max a way to get in touch instead of an upgrade', async () => {
    renderNotice([metric({ fraction: 0.85 })], { tier: 'max' })

    expect(await screen.findByText(/largest plan/)).toBeInTheDocument()
  })

  it('says nothing when usage cannot be read', async () => {
    // The home page's job is to list lectures; a billing sidebar failing is
    // not worth interrupting that with an error.
    renderNotice([], { usageStatus: 500 })

    await waitFor(() => expect(screen.queryByTestId('usage-notice')).toBeNull())
  })
})
