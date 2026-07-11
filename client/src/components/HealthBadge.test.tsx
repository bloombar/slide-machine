/**
 * Unit tests for the compact health bar.
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
  it('reports API and mongo status in the bar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: () => Promise.resolve(healthFixture) }),
    )

    render(<HealthBadge />)

    expect(await screen.findByText('API ok')).toBeInTheDocument()
    expect(screen.getByText('· mongo connected')).toBeInTheDocument()
  })

  it('shows unreachable when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    render(<HealthBadge />)

    expect(await screen.findByText('API unreachable')).toBeInTheDocument()
  })
})
