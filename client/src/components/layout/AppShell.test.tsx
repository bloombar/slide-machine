/**
 * Unit tests for the app shell: primary navigation links and content
 * outlet rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import AppShell from './AppShell'
import { mockFetchRoutes } from '../../test/fetch-mock'

beforeEach(() => {
  setAccessToken(null)
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/app" element={<div>HOME CONTENT</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

describe('AppShell', () => {
  it('renders the primary nav with a hamburger menu, not a standalone profile link', () => {
    renderShell()
    expect(
      screen.getByRole('navigation', { name: 'Primary' }),
    ).toBeInTheDocument()
    // The menu replaces the old standalone profile icon in the nav
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Profile' }),
    ).not.toBeInTheDocument()
  })

  it('brands back to the app home and renders the page content', () => {
    renderShell()
    expect(
      screen.getByRole('link', { name: /slide machine/i }),
    ).toHaveAttribute('href', '/app')
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
  })
})
