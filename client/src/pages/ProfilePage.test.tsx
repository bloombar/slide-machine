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
          profileVisibility: 'public',
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

  it('toggles profile visibility and links to the public profile', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: {
          user: {
            id: 'u1',
            displayName: 'Ada',
            email: 'ada@example.com',
            planTier: 'free',
            profileVisibility: 'public',
          },
          accessToken: 't',
        },
      }),
      '/api/actions/user.setProfileVisibility': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            id: 'u1',
            displayName: 'Ada',
            email: 'ada@example.com',
            planTier: 'free',
            profileVisibility: 'private',
          },
        }
      },
    })
    renderProfile()

    const toggle = await screen.findByRole('checkbox', {
      name: 'Public profile',
    })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await vi.waitFor(() =>
      expect(sent).toEqual({ profileVisibility: 'private' }),
    )
    await vi.waitFor(() => expect(toggle).not.toBeChecked())
    expect(
      screen.getByRole('link', { name: 'View your public profile' }),
    ).toHaveAttribute('href', '/u/u1')
  })

  it('signs out from the bottom button and redirects to login', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })
})
