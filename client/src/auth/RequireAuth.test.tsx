/**
 * Unit tests for the RequireAuth route guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from './AuthContext'
import RequireAuth from './RequireAuth'
import { setAccessToken } from './token'
import { mockFetchRoutes } from '../test/fetch-mock'

const renderGuarded = () =>
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <div>SECRET HOME</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RequireAuth', () => {
  it('redirects anonymous visitors to /login', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })

    renderGuarded()

    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.queryByText('SECRET HOME')).not.toBeInTheDocument()
  })

  it('renders children for authenticated users', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
    })

    renderGuarded()

    expect(await screen.findByText('SECRET HOME')).toBeInTheDocument()
  })
})
