/**
 * Unit tests for the expandable health bar.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { HealthResponse } from '@slide-machine/shared'
import HealthBadge from './HealthBadge'

const healthFixture: HealthResponse = {
  status: 'ok',
  environment: 'development',
  version: '2026.07.18+abc1234',
  uptime: 12.3,
  components: {
    mongo: { status: 'ok', detail: 'connected' },
    storage: { status: 'ok', detail: 'local disk' },
    audioStorage: { status: 'disabled', detail: 'local storage' },
    gemini: { status: 'ok', detail: 'connected' },
    stt: { status: 'disabled', detail: 'browser (client-side)' },
    tts: { status: 'ok', detail: 'ready' },
    translation: { status: 'ok', detail: 'ready' },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const stubFetch = (body: HealthResponse) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ json: () => Promise.resolve(body) }),
  )

describe('HealthBadge', () => {
  it('shows the compact overall status collapsed', async () => {
    stubFetch(healthFixture)

    render(<HealthBadge />)

    expect(await screen.findByText('API ok')).toBeInTheDocument()
    // The breakdown stays hidden until the badge is clicked.
    expect(screen.queryByTestId('health-panel')).not.toBeInTheDocument()
  })

  it('expands to a per-component breakdown when clicked', async () => {
    stubFetch(healthFixture)

    render(<HealthBadge />)
    await screen.findByText('API ok')
    fireEvent.click(screen.getByRole('button'))

    const panel = screen.getByTestId('health-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveTextContent('development')
    expect(panel).toHaveTextContent('2026.07.18+abc1234')
    expect(screen.getByTestId('health-component-mongo')).toHaveTextContent(
      'Database',
    )
    expect(screen.getByTestId('health-component-gemini')).toHaveTextContent(
      'Generative AI',
    )
    // The GCS audio-storage row sits beside the general Storage row.
    expect(
      screen.getByTestId('health-component-audioStorage'),
    ).toHaveTextContent('Audio storage')
    expect(
      screen.getByTestId('health-component-audioStorage'),
    ).toHaveTextContent('local storage')
    expect(screen.getByTestId('health-component-stt')).toHaveTextContent(
      'browser (client-side)',
    )
  })

  it('closes the panel when clicking outside it', async () => {
    stubFetch(healthFixture)

    render(
      <div>
        <button type="button">outside</button>
        <HealthBadge />
      </div>,
    )
    await screen.findByText('API ok')
    fireEvent.click(screen.getByRole('button', { name: /API ok/i }))
    expect(screen.getByTestId('health-panel')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByTestId('health-panel')).not.toBeInTheDocument()
  })

  it('surfaces a degraded overall status', async () => {
    stubFetch({
      ...healthFixture,
      status: 'degraded',
      components: {
        ...healthFixture.components,
        gemini: { status: 'down', detail: 'auth failed' },
      },
    })

    render(<HealthBadge />)

    expect(await screen.findByText('API degraded')).toBeInTheDocument()
  })

  it('shows unreachable when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    render(<HealthBadge />)

    expect(await screen.findByText('API unreachable')).toBeInTheDocument()
  })
})
