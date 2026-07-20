/**
 * Unit tests for the primary-nav hamburger menu: it opens to Home/Profile/
 * Log out when signed in, offers Log in when signed out, and closes on
 * Escape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import ShellMenu from './ShellMenu'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderMenu = (authed: boolean) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      authed
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
    '/api/auth/logout': () => ({ status: 204 }),
  })
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ShellMenu />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('ShellMenu', () => {
  it('opens to Home, Profile, and Log out when signed in', async () => {
    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/app/profile',
      ),
    )
    expect(screen.getByRole('menuitem', { name: 'Home' })).toHaveAttribute(
      'href',
      '/app',
    )
    expect(
      screen.getByRole('menuitem', { name: 'Log out' }),
    ).toBeInTheDocument()
  })

  it('offers Log in instead of Profile/Log out when signed out', () => {
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(screen.getByRole('menuitem', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(
      screen.queryByRole('menuitem', { name: 'Log out' }),
    ).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu after logging out', async () => {
    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    await vi.waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    )
  })
})
