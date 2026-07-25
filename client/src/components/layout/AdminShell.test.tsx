/**
 * Unit tests for the admin shell: admins get the nav bar above the routed
 * page, non-admins get bounced out of the console entirely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import AdminShell from './AdminShell'
import { resetAdminStatus } from '../../hooks/useIsAdmin'
import { mockFetchRoutes } from '../../test/fetch-mock'

const session = {
  status: 200,
  body: {
    user: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
    accessToken: 'token',
  },
}

beforeEach(() => {
  setAccessToken(null)
  resetAdminStatus()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/app/admin/projects']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/admin" element={<AdminShell />}>
            <Route path="projects" element={<div>PROJECTS CONTENT</div>} />
          </Route>
          <Route path="/app" element={<div>APP HOME</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

describe('AdminShell', () => {
  it('renders the admin nav above the routed page for admins', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => session,
      '/api/admin/status': () => ({ status: 200, body: { isAdmin: true } }),
    })
    renderShell()
    expect(await screen.findByText('PROJECTS CONTENT')).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Admin' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })

  it('redirects non-admins away without rendering the nav', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => session,
      '/api/admin/status': () => ({ status: 403 }),
    })
    renderShell()
    expect(await screen.findByText('APP HOME')).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Admin' }),
    ).not.toBeInTheDocument()
  })
})
