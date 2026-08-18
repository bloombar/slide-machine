/**
 * Unit tests for the admin telemetry overview (SPEC EVAL-1): stat tiles,
 * the sessions table with its lecture links, the period-scoped export link,
 * and the error state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { TelemetryOverviewResponse } from '@slide-machine/shared'
import AdminTelemetryPage from './AdminTelemetryPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const overview = (
  over: Partial<TelemetryOverviewResponse> = {},
): TelemetryOverviewResponse => ({
  window: { from: null, to: null },
  totals: {
    sessions: 3,
    stopped: 2,
    abandoned: 1,
    crashed: 0,
    active: 0,
    unknown: 0,
    excludable: 1,
  },
  sessions: [
    {
      sessionId: 'sess-1',
      deckId: 'd1',
      deckName: 'Standing waves',
      startedAt: '2026-09-14T12:30:00.000Z',
      endedAt: '2026-09-14T13:45:00.000Z',
      wallDurationMs: 75 * 60_000,
      capturedMs: 70 * 60_000,
      phraseCount: 240,
      outcomes: {
        none: 80,
        update: 90,
        refit: 5,
        new: 60,
        command: 3,
        discarded: 2,
      },
      finalization: { count: 240, p50Ms: 450, p95Ms: 1_100 },
      generation: { count: 160, p50Ms: 900, p95Ms: 2_400 },
      refusals: 0,
      providerErrors: { unavailable: 1, other: 0 },
      sttRestarts: 18,
      sttErrors: 0,
      longestGenerationOutageMs: 400_000,
      excluded: true,
      endReason: 'stopped',
    },
  ],
  ...over,
})

const renderPage = (
  handler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: overview(),
  }),
) => {
  const mocks = mockFetchRoutes({ '/api/admin/telemetry': handler })
  render(
    <MemoryRouter>
      <AdminTelemetryPage />
    </MemoryRouter>,
  )
  return mocks
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminTelemetryPage', () => {
  it('shows totals and links each session to its lecture', async () => {
    renderPage()
    await screen.findByText('Sessions')
    expect(screen.getByText('Stopped cleanly')).toBeInTheDocument()
    expect(screen.getByText('Excludable')).toBeInTheDocument()

    const lecture = screen.getByRole('link', { name: 'Standing waves' })
    expect(lecture).toHaveAttribute('href', '/app/admin/decks/d1')
    expect(screen.getByText('excluded')).toBeInTheDocument()
  })

  it('scopes the export link to the window actually shown', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Export CSV' })
    // All time: no window params.
    expect(link).toHaveAttribute('href', '/api/admin/telemetry/export')

    fireEvent.change(screen.getByLabelText(/Period/), {
      target: { value: '7' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href'),
      ).toContain('from='),
    )
  })

  it('says plainly when the period holds no sessions', async () => {
    renderPage(() => ({
      status: 200,
      body: overview({
        sessions: [],
        totals: {
          sessions: 0,
          stopped: 0,
          abandoned: 0,
          crashed: 0,
          active: 0,
          unknown: 0,
          excludable: 0,
        },
      }),
    }))
    await screen.findByText('No live sessions recorded in this period.')
  })

  it('reports a load failure as an alert', async () => {
    renderPage(() => ({
      status: 500,
      body: { error: { code: 'server_error', message: 'no' } },
    }))
    await screen.findByRole('alert')
  })
})
