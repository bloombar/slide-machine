/**
 * Unit tests for the deployment-wide cost page's configured-prices section
 * (BILL-7): the price list renders at the bottom of the page, and loads
 * independently of the cost figures so a ledger failure does not hide the
 * rates or vice versa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type {
  CostOverviewResponse,
  ServicePricesResponse,
} from '@slide-machine/shared'
import AdminCostPage from './AdminCostPage'
import { mockFetchRoutes } from '../test/fetch-mock'

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
}: { overviewStatus?: number; pricesStatus?: number } = {}) => {
  const mocks = mockFetchRoutes({
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

afterEach(() => vi.unstubAllGlobals())

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
