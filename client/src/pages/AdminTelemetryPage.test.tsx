/**
 * Unit tests for the admin telemetry overview (SPEC EVAL-1): stat tiles,
 * the sessions table with its lecture links, the token-bearing period-scoped CSV export,
 * and the error state.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { TelemetryOverviewResponse } from '@slide-machine/shared'
import AdminTelemetryPage from './AdminTelemetryPage'
import { COLUMN_HINTS } from '../components/admin/TelemetryPanel'
import { mockFetchRoutes } from '../test/fetch-mock'
import { setAccessToken } from '../auth/token'
import { saveBlob } from '../lib/download'

vi.mock('../lib/download')

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

let exportResponse: () => { status: number; body?: unknown } = () => ({
  status: 200,
  body: 'sessionId,deckId\n',
})

const renderPage = (
  handler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: overview(),
  }),
) => {
  // The export key must come first: the overview key is a prefix of it.
  const mocks = mockFetchRoutes({
    '/api/admin/telemetry/export': () => exportResponse(),
    '/api/admin/telemetry': handler,
  })
  render(
    <MemoryRouter>
      <AdminTelemetryPage />
    </MemoryRouter>,
  )
  return mocks
}

beforeEach(() => {
  vi.mocked(saveBlob).mockReset()
  exportResponse = () => ({ status: 200, body: 'sessionId,deckId\n' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
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

  it('exports the CSV with the admin token, for the window shown', async () => {
    setAccessToken('admin-token')
    const { fetchMock, calls } = renderPage()
    const button = await screen.findByRole('button', { name: 'Export CSV' })
    await waitFor(() => expect(button).toBeEnabled())
    const exportCalls = () => calls.filter(c => c.includes('/export'))

    // All time: no window params.
    fireEvent.click(button)
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1))
    expect(exportCalls()).toEqual(['/api/admin/telemetry/export'])
    const init = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/export'),
    )![1]
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer admin-token',
    )
    const [blob, fileName] = vi.mocked(saveBlob).mock.calls[0]!
    expect(await blob.text()).toBe('sessionId,deckId\n')
    expect(fileName).toMatch(/^session-telemetry-\d{4}-\d{2}-\d{2}\.csv$/)

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
    const button = await screen.findByRole('button', { name: 'Export CSV' })
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
    exportResponse = () => ({
      status: 401,
      body: { error: { code: 'unauthorized', message: 'Sign in to continue' } },
    })
    renderPage()
    const button = await screen.findByRole('button', { name: 'Export CSV' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not export/i,
    )
    expect(saveBlob).not.toHaveBeenCalled()
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

  it('explains every column, including Lecture, on hover', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Standing waves' })
    // Hints render through the house Tooltip inside each header cell.
    expect(screen.getByText(COLUMN_HINTS['Lecture']!)).toBeInTheDocument()
    expect(screen.getByText(COLUMN_HINTS['Ended']!)).toBeInTheDocument()
    expect(screen.getByText(COLUMN_HINTS['Gen. p50/p95']!)).toBeInTheDocument()
  })

  it('reports a load failure as an alert', async () => {
    renderPage(() => ({
      status: 500,
      body: { error: { code: 'server_error', message: 'no' } },
    }))
    await screen.findByRole('alert')
  })
})
