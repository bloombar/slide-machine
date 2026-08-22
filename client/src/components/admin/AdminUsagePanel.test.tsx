/**
 * Unit tests for the admin view of one account's usage: the same meters the
 * account's own footer badge shows (BILL-4), defaulting to the current
 * billing period with an all-time alternative, plus the one write on it —
 * handing the period's allowances back (ADMIN-10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * @param spent What each period read returns, in order — a reset is only
 *   observable if the second read differs from the first.
 * @param reset What the reset endpoint answers; a 500 stands for a refusal.
 */
const renderPanel = ({
  failPeriod = false,
  spent = [1000],
  reset = {
    status: 200,
    body: { period: '2026-08', cleared: { aiTokens: 1000 } },
  },
}: {
  failPeriod?: boolean
  spent?: number[]
  reset?: { status: number; body: unknown }
} = {}) => {
  let read = 0
  return mockFetchRoutes({
    '/api/admin/users/u1/usage/reset': () => reset,
    '/api/admin/users/u1/usage?window=all': () => ({
      status: 200,
      body: allTime(),
    }),
    '/api/admin/users/u1/usage?window=period': () => {
      const used = spent[Math.min(read++, spent.length - 1)]!
      const body = summary()
      return {
        status: failPeriod ? 500 : 200,
        body: failPeriod
          ? { error: { code: 'server_error', message: 'no' } }
          : {
              ...body,
              metrics: body.metrics.map(m =>
                m.metric === 'aiTokens'
                  ? { ...m, used, fraction: used / 10_000 }
                  : m,
              ),
            },
      }
    },
  })
}

/** Opens the confirm and takes the offer. */
const confirmReset = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Reset allowances' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Reset allowances' }),
  )
}

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

describe('resetting the allowances (ADMIN-10)', () => {
  it('confirms first, then clears the period and re-reads the meters', async () => {
    const { calls } = renderPanel({ spent: [1000, 0] })
    render(<AdminUsagePanel userId="u1" />)
    await screen.findByText('1,000 of 10,000')

    // Nothing is sent on the button alone: the account is not the admin's.
    fireEvent.click(screen.getByRole('button', { name: 'Reset allowances' }))
    expect(calls.some(url => url.includes('/usage/reset'))).toBe(false)

    const dialog = await screen.findByRole('alertdialog')
    // The confirm says what a reset does *not* touch, since that is what an
    // operator would otherwise assume it does.
    expect(dialog).toHaveTextContent(/Stored audio is not reset/)
    expect(dialog).toHaveTextContent(/audit log/)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Reset allowances' }),
    )

    // What was cleared, not merely that something was: zero either way.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reset 1 allowance for this period.',
    )
    expect(calls.some(url => url.includes('/usage/reset'))).toBe(true)
    // The meters are re-read rather than left showing what was just cleared.
    expect(await screen.findByText('0 of 10,000')).toBeInTheDocument()
  })

  it('says so when there was nothing to give back', async () => {
    renderPanel({
      reset: { status: 200, body: { period: '2026-08', cleared: {} } },
    })
    render(<AdminUsagePanel userId="u1" />)
    await screen.findByTestId('usage-metric-aiTokens')

    await confirmReset()

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nothing to reset — every allowance was already at zero for this period.',
    )
  })

  it('reports a refusal instead of implying the reset landed', async () => {
    renderPanel({
      reset: {
        status: 404,
        body: { error: { code: 'not_found', message: 'User not found' } },
      },
    })
    render(<AdminUsagePanel userId="u1" />)
    await screen.findByTestId('usage-metric-aiTokens')

    await confirmReset()

    // The endpoint's own words: an admin can act on "User not found".
    expect(await screen.findByRole('alert')).toHaveTextContent('User not found')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('withholds the offer for an account that cannot be reset', async () => {
    renderPanel()
    render(<AdminUsagePanel userId="u1" canReset={false} />)
    await screen.findByTestId('usage-metric-aiTokens')

    // A deleted account is restored, not adjusted: the endpoint would 404, so
    // the button would only promise something it cannot do.
    expect(
      screen.queryByRole('button', { name: 'Reset allowances' }),
    ).not.toBeInTheDocument()
  })
})
