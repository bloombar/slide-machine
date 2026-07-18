/**
 * Unit tests for the landing page: hero for anonymous visitors, straight
 * to the home screen for signed-in users.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import LandingPage from './LandingPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const renderLanding = (refreshStatus: number) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      refreshStatus === 200
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
    '/api/health': () => ({
      status: 200,
      body: {
        status: 'ok',
        environment: 'test',
        version: '0',
        uptime: 1,
        components: {
          mongo: { status: 'ok', detail: 'connected' },
          storage: { status: 'ok', detail: 'local disk' },
          gemini: { status: 'disabled', detail: 'not configured' },
          stt: { status: 'disabled', detail: 'browser (client-side)' },
        },
      },
    }),
  })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<div>HOME SCREEN</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LandingPage', () => {
  it('shows the hero to anonymous visitors', async () => {
    renderLanding(401)
    expect(
      await screen.findByRole('heading', { name: 'The Slide Machine V2' }),
    ).toBeInTheDocument()
  })

  it('sends signed-in users to their home screen', async () => {
    renderLanding(200)
    expect(await screen.findByText('HOME SCREEN')).toBeInTheDocument()
  })
})
