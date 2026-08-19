/**
 * Unit tests for the admin view of one account's usage: the same meters the
 * account's own footer badge shows (BILL-4), defaulting to the current
 * billing period with an all-time alternative.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type {
  UsageMetricSummary,
  UsageSummaryResponse,
} from '@slide-machine/shared'
import AdminUsagePanel from './AdminUsagePanel'
import { mockFetchRoutes } from '../../test/fetch-mock'

const metric = (
  over: Partial<UsageMetricSummary> = {},
): UsageMetricSummary => ({
  metric: 'aiTokens',
  used: 1000,
  cap: 10_000,
  fraction: 0.1,
  allowance: 'instructor',
  unit: 'tokens',
  gauge: false,
  ...over,
})

const summary = (
  over: Partial<UsageSummaryResponse> = {},
): UsageSummaryResponse => ({
  tier: 'free',
  period: '2026-08',
  resetAt: '2026-09-01T00:00:00.000Z',
  metrics: [
    metric(),
    metric({
      metric: 'audienceTtsCharacters',
      allowance: 'audience',
      unit: 'characters',
      used: 200,
      cap: 5000,
      fraction: 0.04,
    }),
  ],
  ...over,
})

/** The lifetime view the server sends: caps dropped from flows. */
const allTime = (): UsageSummaryResponse =>
  summary({
    period: 'all',
    metrics: [metric({ used: 5000, cap: null, fraction: null })],
  })

const renderPanel = ({ failPeriod = false } = {}) =>
  mockFetchRoutes({
    '/api/admin/users/u1/usage?window=all': () => ({
      status: 200,
      body: allTime(),
    }),
    '/api/admin/users/u1/usage?window=period': () => ({
      status: failPeriod ? 500 : 200,
      body: failPeriod
        ? { error: { code: 'server_error', message: 'no' } }
        : summary(),
    }),
  })

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('AdminUsagePanel', () => {
  it('defaults to the current period and shows the badge’s meters', async () => {
    const { calls } = renderPanel()
    render(<AdminUsagePanel userId="u1" />)

    // The same row the footer badge renders, cap and all.
    await screen.findByTestId('usage-metric-aiTokens')
    expect(screen.getByText('AI generation')).toBeInTheDocument()
    expect(screen.getByText('1,000 of 10,000')).toBeInTheDocument()
    // The default asks for the period the caps bind against, and says when
    // the allowances renew.
    expect(calls[0]).toContain('window=period')
    expect(screen.getByText(/Resets September 1, 2026/)).toBeInTheDocument()
  })

  it('keeps the instructor and audience allowances apart', async () => {
    renderPanel()
    render(<AdminUsagePanel userId="u1" />)

    await screen.findByTestId('usage-metric-audienceTtsCharacters')
    expect(screen.getByText('Instructor allowances')).toBeInTheDocument()
    expect(screen.getByText('Audience allowances')).toBeInTheDocument()
  })

  it('switches to all time: refetches and shows totals without caps', async () => {
    const { calls } = renderPanel()
    render(<AdminUsagePanel userId="u1" />)
    await screen.findByTestId('usage-metric-aiTokens')

    fireEvent.click(screen.getByRole('button', { name: 'All time' }))

    // A lifetime total has no cap to be "of": it renders as a plain amount.
    expect(await screen.findByText('5,000 used')).toBeInTheDocument()
    expect(calls.some(url => url.includes('window=all'))).toBe(true)
    expect(screen.queryByText(/Resets/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('says so when the summary cannot be loaded', async () => {
    renderPanel({ failPeriod: true })
    render(<AdminUsagePanel userId="u1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load usage.',
    )
  })
})
