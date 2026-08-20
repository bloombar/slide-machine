/**
 * Unit tests for the configured-prices panel (BILL-7): the in-use rates come
 * out as served, sub-cent rates are not rounded to free, percent fees print
 * as percentages, an all-free configuration says so plainly, and a failed
 * load reads as a failure rather than as an empty price list.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ServicePricesResponse } from '@slide-machine/shared'
import ServicePricesPanel from './ServicePricesPanel'
import { mockFetchRoutes } from '../../test/fetch-mock'

const prices = (
  over: Partial<ServicePricesResponse> = {},
): ServicePricesResponse => ({
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
    {
      service: 'AI generation',
      detail: 'gemini-3.5-flash-lite',
      unit: 'per 1M output tokens',
      rate: 2.5,
      kind: 'currency',
    },
    {
      service: 'Speech-to-text',
      detail: 'streaming recognition',
      unit: 'per minute',
      rate: 0.016,
      kind: 'currency',
    },
    {
      service: 'Narration',
      detail: 'standard voices (neural2)',
      unit: 'per 1M characters',
      rate: 16,
      kind: 'currency',
      note: 'First 1,000,000 characters each month are free',
    },
    {
      service: 'Payments',
      detail: 'card processing',
      unit: 'of each charge',
      rate: 0.029,
      kind: 'percent',
    },
  ],
  ...over,
})

const renderPanel = (body: ServicePricesResponse | null = prices()) => {
  const mocks = mockFetchRoutes({
    '/api/admin/cost/prices': () => ({
      status: body ? 200 : 500,
      body: body ?? { error: { code: 'server_error', message: 'no' } },
    }),
  })
  render(<ServicePricesPanel />)
  return mocks
}

afterEach(() => vi.unstubAllGlobals())

/** The table row whose service cell contains `text`. */
const row = (text: string): HTMLElement =>
  screen.getByText(text).closest('tr') as HTMLElement

describe('ServicePricesPanel', () => {
  it('shows each in-use rate with its unit, and says where they come from', async () => {
    renderPanel()
    expect(
      await screen.findByRole('heading', { name: 'Configured prices' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/last verified 2026-07-31/)).toBeInTheDocument()
    expect(screen.getByText(/figures in USD/)).toBeInTheDocument()
    // Read live from configuration, so a config change shows on refresh.
    expect(
      screen.getByText(/Read live from the configuration/),
    ).toBeInTheDocument()
    expect(screen.getByText('$0.30 per 1M input tokens')).toBeVisible()
    expect(screen.getByText('$16.00 per 1M characters')).toBeVisible()
    expect(screen.getAllByText('gemini-3.5-flash-lite')).toHaveLength(2)
  })

  it('does not round a sub-cent rate down to free', async () => {
    renderPanel()
    await screen.findByText('Speech-to-text')
    expect(
      within(row('Speech-to-text')).getByText('$0.016 per minute'),
    ).toBeVisible()
  })

  it('shows percent fees as percentages, not currency', async () => {
    renderPanel()
    await screen.findByText('Payments')
    expect(
      within(row('Payments')).getByText('2.9% of each charge'),
    ).toBeVisible()
  })

  it('shows a free allowance beside the rate it qualifies', async () => {
    renderPanel()
    await screen.findByText('Narration')
    expect(
      within(row('Narration')).getByText(
        'First 1,000,000 characters each month are free',
      ),
    ).toBeVisible()
  })

  it('says plainly when no configured service costs anything', async () => {
    renderPanel(prices({ prices: [] }))
    expect(
      await screen.findByText(
        'No paid services are active in the current configuration.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a failure rather than an empty price list', async () => {
    renderPanel(null)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load the configured prices',
      ),
    )
  })
})
