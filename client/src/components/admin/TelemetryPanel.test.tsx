/**
 * Unit tests for the admin telemetry panel (SPEC EVAL-1): the four fetch
 * states, the end-reason badge, and the exclusion marker that flags a
 * session the study's rule would drop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TelemetrySessionSummary } from '@slide-machine/shared'
import TelemetryPanel, { formatDurationMs, formatMs } from './TelemetryPanel'
import { mockFetchRoutes } from '../../test/fetch-mock'

const session = (
  over: Partial<TelemetrySessionSummary> = {},
): TelemetrySessionSummary => ({
  sessionId: 'sess-1',
  deckId: 'd1',
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
  finalization: { count: 240, p50Ms: 450, p95Ms: 1_200 },
  generation: { count: 160, p50Ms: 900, p95Ms: 2_400 },
  refusals: 1,
  providerErrors: { unavailable: 0, other: 1 },
  sttRestarts: 18,
  sttErrors: 0,
  longestGenerationOutageMs: null,
  excluded: false,
  endReason: 'stopped',
  ...over,
})

const renderPanel = (
  sessions: TelemetrySessionSummary[] | null = [session()],
) => {
  mockFetchRoutes({
    '/api/admin/telemetry/decks/d1': () => ({
      status: sessions ? 200 : 500,
      body: sessions
        ? { sessions }
        : { error: { code: 'server_error', message: 'no' } },
    }),
  })
  render(<TelemetryPanel deckId="d1" />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('TelemetryPanel', () => {
  it('shows a session row with its figures and end badge', async () => {
    renderPanel()
    await screen.findByText('Stopped')
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText('1:15:00')).toBeInTheDocument()
    // The cell's text is split across JSX expressions, so match the cell.
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'TD' && el.textContent === '450ms / 1200ms',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('excluded')).not.toBeInTheDocument()
  })

  it('marks a session the study rule would exclude', async () => {
    renderPanel([
      session({ excluded: true, longestGenerationOutageMs: 400_000 }),
    ])
    await screen.findByText('excluded')
  })

  it('says plainly when no sessions were recorded', async () => {
    renderPanel([])
    await screen.findByText('No live sessions recorded yet.')
  })

  it('reports a load failure as an alert', async () => {
    renderPanel(null)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not load sessions.',
    )
  })
})

describe('formatting', () => {
  it('renders milliseconds compactly and dashes the unknowable', () => {
    expect(formatMs(450)).toBe('450ms')
    expect(formatMs(12_340)).toBe('12.3s')
    expect(formatMs(null)).toBe('—')
    expect(formatDurationMs(65_000)).toBe('1:05')
    expect(formatDurationMs(3_665_000)).toBe('1:01:05')
    expect(formatDurationMs(null)).toBe('—')
  })
})
