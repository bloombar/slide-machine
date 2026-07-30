/**
 * Unit tests for the primary-nav hamburger menu: it opens to Home/Profile/
 * Log out when signed in, offers Log in when signed out, closes on
 * Escape, and shows admins an "Admin" flyout submenu of admin sections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import { resetAdminStatus } from '../../hooks/useIsAdmin'
import ShellMenu from './ShellMenu'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderMenu = (authed: boolean, isAdmin = false) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      authed
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
    '/api/auth/logout': () => ({ status: 204 }),
    '/api/admin/status': () =>
      isAdmin ? { status: 200, body: { isAdmin: true } } : { status: 403 },
  })
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ShellMenu />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setAccessToken(null)
  resetAdminStatus()
})
afterEach(() => vi.unstubAllGlobals())

describe('ShellMenu', () => {
  it('points Profile at the signed-in user’s own profile page', async () => {
    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/u/u1',
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

  it('hides the Admin entry from non-admins', async () => {
    renderMenu(true, false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('menuitem', { name: 'Profile' })
    // The status check resolves to 403; no Admin entry appears
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('menuitem', { name: 'Admin' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows admins an Admin flyout submenu on hover with every section', async () => {
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const trigger = await screen.findByRole('menuitem', { name: 'Admin' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(
      screen.queryByRole('menu', { name: 'Admin' }),
    ).not.toBeInTheDocument()

    fireEvent.mouseEnter(trigger.parentElement!)
    expect(screen.getByRole('menuitem', { name: 'Users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
    expect(screen.getByRole('menuitem', { name: 'Logs' })).toHaveAttribute(
      'href',
      '/app/admin/logs',
    )

    fireEvent.mouseLeave(trigger.parentElement!)
    expect(
      screen.queryByRole('menuitem', { name: 'Users' }),
    ).not.toBeInTheDocument()
  })

  it('toggles the Admin submenu on click for keyboard and touch', async () => {
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const trigger = await screen.findByRole('menuitem', { name: 'Admin' })

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Logs' })).toBeVisible()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('menuitem', { name: 'Logs' }),
    ).not.toBeInTheDocument()
  })
})
