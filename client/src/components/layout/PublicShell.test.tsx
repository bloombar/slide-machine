/**
 * Unit tests for the public shell: logo left; the profile icon on the
 * right opens the profile when signed in and login otherwise.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import PublicShell from './PublicShell'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderShell = (refreshStatus: number) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      refreshStatus === 200
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
  })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<PublicShell />}>
            <Route path="/" element={<div>PAGE</div>} />
          </Route>
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

describe('PublicShell', () => {
  it('routes the profile icon to the profile for signed-in users', async () => {
    renderShell(200)
    await screen.findByText('PAGE')
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/app/profile',
      ),
    )
  })

  it('routes the profile icon to login for anonymous visitors', async () => {
    renderShell(401)
    await screen.findByText('PAGE')
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/login',
      ),
    )
  })

  it('brands home on the left', async () => {
    renderShell(401)
    expect(
      await screen.findByRole('link', { name: /slide machine/i }),
    ).toHaveAttribute('href', '/')
  })
})
