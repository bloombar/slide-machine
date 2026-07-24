/**
 * Unit tests for the admin route guard: anonymous → /login, signed-in
 * non-admin → /app, admin → children. Exercises useIsAdmin through its
 * real fetch path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './AuthContext'
import RequireAdmin from './RequireAdmin'
import { resetAdminStatus } from '../hooks/useIsAdmin'
import { mockFetchRoutes } from '../test/fetch-mock'

const session = {
  user: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
  accessToken: 'token',
}

const renderGuarded = (routes: Parameters<typeof mockFetchRoutes>[0]) => {
  const mocks = mockFetchRoutes(routes)
  render(
    <MemoryRouter initialEntries={['/app/admin']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/app" element={<p>Home page</p>} />
          <Route
            path="/app/admin"
            element={
              <RequireAdmin>
                <p>Admin area</p>
              </RequireAdmin>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return mocks
}

beforeEach(() => {
  resetAdminStatus()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RequireAdmin', () => {
  it('redirects anonymous visitors to /login', async () => {
    renderGuarded({
      '/api/auth/refresh': () => ({ status: 401 }),
    })
    expect(await screen.findByText('Login page')).toBeVisible()
  })

  it('renders children for an admin', async () => {
    renderGuarded({
      '/api/auth/refresh': () => ({ status: 200, body: session }),
      '/api/admin/status': () => ({ status: 200, body: { isAdmin: true } }),
    })
    expect(await screen.findByText('Admin area')).toBeVisible()
  })

  it('redirects a signed-in non-admin to /app', async () => {
    renderGuarded({
      '/api/auth/refresh': () => ({ status: 200, body: session }),
      '/api/admin/status': () => ({ status: 403 }),
    })
    expect(await screen.findByText('Home page')).toBeVisible()
  })

  it('caches the admin answer per account (one status fetch)', async () => {
    const { calls } = renderGuarded({
      '/api/auth/refresh': () => ({ status: 200, body: session }),
      '/api/admin/status': () => ({ status: 200, body: { isAdmin: true } }),
    })
    await screen.findByText('Admin area')
    const statusCalls = calls.filter(url => url.includes('/api/admin/status'))
    expect(statusCalls).toHaveLength(1)
  })
})
