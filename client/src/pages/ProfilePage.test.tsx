/**
 * Unit tests for the profile page: account details and bottom sign-out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import ProfilePage from './ProfilePage'
import { mockFetchRoutes } from '../test/fetch-mock'

beforeEach(() => {
  setAccessToken(null)
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: {
        user: {
          id: 'u1',
          displayName: 'Ada',
          email: 'ada@example.com',
          planTier: 'free',
        },
        accessToken: 't',
      },
    }),
    '/api/auth/logout': () => ({ status: 204 }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderProfile = () =>
  render(
    <MemoryRouter initialEntries={['/app/profile']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/profile" element={<ProfilePage />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

describe('ProfilePage', () => {
  it('shows account details and plan tier', async () => {
    renderProfile()
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('free')).toBeInTheDocument()
  })

  it('signs out from the bottom button and redirects to login', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })
})
