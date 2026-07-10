/**
 * Unit tests for the health badge (moved from the original App test).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { HealthResponse } from '@slide-machine/shared'
import HealthBadge from './HealthBadge'

const healthFixture: HealthResponse = {
  status: 'ok',
  mongo: 'connected',
  uptime: 12.3,
  version: '0.1.0',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HealthBadge', () => {
  it('renders the API health status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: () => Promise.resolve(healthFixture) }),
    )

    render(<HealthBadge />)

    expect(await screen.findByTestId('health-badge')).toHaveTextContent('ok')
    expect(screen.getByText('mongo: connected')).toBeInTheDocument()
  })

  it('shows unreachable when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    render(<HealthBadge />)

    expect(await screen.findByTestId('health-badge')).toHaveTextContent(
      'unreachable',
    )
  })
})
