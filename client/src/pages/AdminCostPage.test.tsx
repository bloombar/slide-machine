/**
 * Unit tests for the deployment-wide cost page's configured-prices section
 * (BILL-7): the price list renders at the bottom of the page, and loads
 * independently of the cost figures so a ledger failure does not hide the
 * rates or vice versa. Also the token-bearing CSV export.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type {
  CostOverviewResponse,
  ServicePricesResponse,
} from '@slide-machine/shared'
import AdminCostPage from './AdminCostPage'
import { mockFetchRoutes } from '../test/fetch-mock'
import { setAccessToken } from '../auth/token'
import { saveBlob } from '../lib/download'

vi.mock('../lib/download')

const money = (micros: number) => ({
  micros,
  amount: Math.round((micros / 1_000_000) * 100) / 100,
  currency: 'USD',
})

const overview = (): CostOverviewResponse => ({
  window: { from: null, to: null },
  totals: {
    total: money(2_500_000),
    instructor: money(2_000_000),
    audience: money(500_000),
    system: money(0),
    byMetric: [],
    registeredViewers: 10,
    anonymousEvents: 0,
    costPerRegisteredViewer: money(50_000),
    cache: {
      billableEvents: 20,
      cachedEvents: 30,
      hitRatio: 0.6,
      estimatedAvoided: money(750_000),
    },
  },
  activeUsers: 4,
  activeViewers: 10,
  lecturesWithSpend: 3,
  projectsWithSpend: 2,
  averages: {
    perUser: money(625_000),
    perLecture: money(833_333),
    perProject: money(1_250_000),
    perRegisteredViewer: money(50_000),
  },
  topSpenders: [],
})

const servicePrices = (): ServicePricesResponse => ({
  asOf: '2026-07-31',
  currency: 'USD',
  prices: [
    {
      service: 'AI generation',
      detail: 'gemini-3.5-flash-lite',
      unit: 'per 1M input tokens',
      rate: 0.3,
      kind: 'currency',
    },
  ],
})

/** Route order matters: the prices key must be tried before the overview
 * key, which is a prefix of it. */
const renderPage = ({
  overviewStatus = 200,
  pricesStatus = 200,
  exportStatus = 200,
}: {
  overviewStatus?: number
  pricesStatus?: number
  exportStatus?: number
} = {}) => {
  const mocks = mockFetchRoutes({
    '/api/admin/cost/export': () => ({
      status: exportStatus,
      body:
        exportStatus === 200
          ? 'occurredAt,payerId\n'
          : { error: { code: 'unauthorized', message: 'Sign in to continue' } },
    }),
    '/api/admin/cost/prices': () => ({
      status: pricesStatus,
      body:
        pricesStatus === 200
          ? servicePrices()
          : { error: { code: 'server_error', message: 'no' } },
    }),
    '/api/admin/cost': () => ({
      status: overviewStatus,
      body:
        overviewStatus === 200
          ? overview()
          : { error: { code: 'server_error', message: 'no' } },
    }),
  })
  render(
    <MemoryRouter>
      <AdminCostPage />
    </MemoryRouter>,
  )
  return mocks
}

beforeEach(() => vi.mocked(saveBlob).mockReset())

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('AdminCostPage configured prices', () => {
  it('shows the configured prices below the cost figures', async () => {
    renderPage()
    expect(await screen.findByText('Total')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Configured prices' }),
    ).toBeInTheDocument()
    expect(screen.getByText('gemini-3.5-flash-lite')).toBeInTheDocument()
    // The heading order is the page order: figures first, rates last.
    const headings = screen
      .getAllByRole('heading')
      .map(h => h.textContent ?? '')
    expect(headings.indexOf('Configured prices')).toBeGreaterThan(
      headings.indexOf('Cost'),
    )
  })

  it('still shows the price list when the ledger fails', async () => {
    renderPage({ overviewStatus: 500 })
    expect(await screen.findByText('Could not load cost.')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Configured prices' }),
    ).toBeInTheDocument()
    expect(screen.getByText('gemini-3.5-flash-lite')).toBeInTheDocument()
  })

  it('still shows the cost figures when the price list fails', async () => {
    renderPage({ pricesStatus: 500 })
    expect(await screen.findByText('Total')).toBeInTheDocument()
    expect(
      await screen.findByText('Could not load the configured prices.'),
    ).toBeInTheDocument()
  })
})

describe('AdminCostPage CSV export', () => {
  it('exports with the admin token, for the window shown', async () => {
    setAccessToken('admin-token')
    const { fetchMock, calls } = renderPage()
    await screen.findByText('Total')
    const button = screen.getByRole('button', { name: 'Export CSV' })
    const exportCalls = () => calls.filter(c => c.includes('/export'))

    fireEvent.click(button)
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1))
    expect(exportCalls()).toEqual(['/api/admin/cost/export'])
    const init = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/export'),
    )![1]
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer admin-token',
    )
    const [blob, fileName] = vi.mocked(saveBlob).mock.calls[0]!
    expect(await blob.text()).toBe('occurredAt,payerId\n')
    expect(fileName).toMatch(/^cost-ledger-\d{4}-\d{2}-\d{2}\.csv$/)

    fireEvent.change(screen.getByLabelText(/Period/), {
      target: { value: '7' },
    })
    await waitFor(() => expect(calls.some(c => c.includes('from='))).toBe(true))
    fireEvent.click(button)
    await waitFor(() => expect(exportCalls()).toHaveLength(2))
    expect(exportCalls()[1]).toContain('/export?from=')
  })

  it('cannot export while a newly picked period is still loading', async () => {
    const { calls } = renderPage()
    await screen.findByText('Total')
    const button = screen.getByRole('button', { name: 'Export CSV' })
    await waitFor(() => expect(button).toBeEnabled())

    // Hold the next overview fetch open: the new period's window is unknown.
    const base = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('from=')
          ? new Promise<Response>(() => {})
          : base(input, init),
      ),
    )
    fireEvent.change(screen.getByLabelText(/Period/), {
      target: { value: '7' },
    })
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    expect(calls.filter(c => c.includes('/export'))).toHaveLength(0)
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('shows an alert when the export is refused, and saves nothing', async () => {
    renderPage({ exportStatus: 401 })
    await screen.findByText('Total')
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not export/i,
    )
    expect(saveBlob).not.toHaveBeenCalled()
  })
})
