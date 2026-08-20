/**
 * Unit tests for the admin cost panel (BILL-7).
 *
 * The assertions are about what the panel refuses to imply: that a sub-cent
 * total is free, that anonymous viewers are people, or that a per-viewer
 * average covers everyone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CostSummaryResponse } from '@slide-machine/shared'
import CostPanel from './CostPanel'
import { mockFetchRoutes } from '../../test/fetch-mock'

const money = (micros: number) => ({
  micros,
  amount: Math.round((micros / 1_000_000) * 100) / 100,
  currency: 'USD',
})

const summary = (
  over: Partial<CostSummaryResponse> = {},
): CostSummaryResponse => ({
  total: money(2_500_000),
  instructor: money(2_000_000),
  audience: money(500_000),
  system: money(0),
  byMetric: [
    {
      metric: 'aiTokens',
      quantity: 120_000,
      cost: money(2_000_000),
      events: 8,
    },
    {
      metric: 'audienceTtsCharacters',
      quantity: 4_000,
      cost: money(500_000),
      events: 12,
    },
  ],
  registeredViewers: 10,
  anonymousEvents: 34,
  costPerRegisteredViewer: money(50_000),
  cache: {
    billableEvents: 20,
    cachedEvents: 30,
    hitRatio: 0.6,
    estimatedAvoided: money(750_000),
  },
  window: { from: '2026-08-01T00:00:00.000Z', to: null },
  ...over,
})

const renderPanel = (body: CostSummaryResponse | null = summary()) => {
  const mocks = mockFetchRoutes({
    '/api/admin/cost/decks/d1': () => ({
      status: body ? 200 : 500,
      body: body ?? { error: { code: 'server_error', message: 'no' } },
    }),
  })
  render(<CostPanel scope={{ kind: 'deck', id: 'd1' }} />)
  return mocks
}

/** The value shown under a labelled figure. Reading by label rather than by
 * text, because the same amount legitimately appears in more than one box —
 * a total that is all instructor spend equals the instructor figure. */
const figure = (label: string): string =>
  screen.getByText(label).parentElement?.querySelector('dd')?.textContent ?? ''

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('CostPanel', () => {
  it('defaults to the billing period and captions whose period it is', async () => {
    // The usage meters nearby cover the same window; without the caption the
    // two panels look like they disagree about the same numbers.
    const { calls } = renderPanel()
    expect(
      await screen.findByText(
        /What this lecture has cost the deployment during its owner's current billing period — since August 1, 2026/,
      ),
    ).toBeInTheDocument()
    expect(calls[0]).toContain('window=period')
    expect(
      screen.getByRole('button', { name: 'Current billing period' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to the all-time ledger and says it never resets', async () => {
    const { calls } = renderPanel()
    await screen.findByText('Total')

    fireEvent.click(screen.getByRole('button', { name: 'All time' }))

    expect(
      await screen.findByText(/Everything this lecture has ever cost/),
    ).toBeInTheDocument()
    expect(screen.getByText(/never reset/)).toBeInTheDocument()
    expect(calls.some(url => url.includes('window=all'))).toBe(true)
  })

  it('separates what the owner caused from what their audience did', async () => {
    // One total would hide the only thing the number is useful for: the two
    // have different remedies.
    renderPanel()
    await screen.findByText('Total')
    expect(figure('Total')).toBe('$2.50')
    expect(figure('Instructor')).toBe('$2.00')
    expect(figure('Audience')).toBe('$0.50')
  })

  it('says a per-viewer figure covers registered viewers only', async () => {
    renderPanel()
    expect(await screen.findByText('Per registered viewer')).toBeInTheDocument()
    expect(screen.getByText('Excludes anonymous viewers')).toBeInTheDocument()
    expect(screen.getByText('Viewers reached')).toBeInTheDocument()
    expect(screen.getByText('Events, not people')).toBeInTheDocument()
    // Anonymous activity is shown as a count, beside the people it is not.
    expect(screen.getByText('34')).toBeInTheDocument()
  })

  it('reports cache efficiency and what it avoided', async () => {
    renderPanel()
    await screen.findByText('Served from cache')
    expect(figure('Served from cache')).toBe('60%')
    expect(screen.getByText('30 of 50 events')).toBeInTheDocument()
    expect(screen.getByText('Estimated, by caching')).toBeInTheDocument()
  })

  it('does not round a sub-cent total down to nothing', async () => {
    // A single slide generation costs a fraction of a penny; "$0.00" would
    // read as free rather than as very cheap.
    renderPanel(
      summary({
        total: money(400),
        instructor: money(400),
        audience: money(0),
        costPerRegisteredViewer: null,
        byMetric: [],
      }),
    )
    await screen.findByText('Total')
    expect(figure('Total')).toBe('$0.0004')
  })

  it('names services in plain language, not by metric id', async () => {
    renderPanel()
    expect(await screen.findByText('AI generation')).toBeInTheDocument()
    expect(screen.getByText('Narration for viewers')).toBeInTheDocument()
    expect(screen.queryByText('aiTokens')).toBeNull()
  })

  it('mentions system spend only when there is some', async () => {
    renderPanel()
    await screen.findByText('Total')
    expect(screen.queryByText(/caused by the system/)).toBeNull()

    renderPanel(summary({ system: money(1_000) }))
    expect(
      await screen.findByText(/caused by the system rather than by a person/),
    ).toBeInTheDocument()
  })

  it('says plainly when nothing has been metered', async () => {
    renderPanel(
      summary({
        total: money(0),
        instructor: money(0),
        audience: money(0),
        byMetric: [],
        registeredViewers: 0,
        anonymousEvents: 0,
        costPerRegisteredViewer: null,
        cache: {
          billableEvents: 0,
          cachedEvents: 0,
          hitRatio: null,
          estimatedAvoided: money(0),
        },
      }),
    )
    // The empty state names the window, since "nothing this period" and
    // "nothing ever" are different facts.
    expect(
      await screen.findByText('Nothing metered in this billing period.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(
      await screen.findByText('Nothing metered here yet.'),
    ).toBeInTheDocument()
  })

  it('reports a failure rather than an empty panel', async () => {
    renderPanel(null)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load cost',
      ),
    )
  })
})
