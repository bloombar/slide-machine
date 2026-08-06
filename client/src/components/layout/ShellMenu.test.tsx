/**
 * Unit tests for the primary-nav hamburger menu: it opens to Home/Profile/
 * Account settings/Log out when signed in, offers Log in when signed out,
 * closes on
 * Escape, and shows admins an "Admin" flyout submenu of admin sections —
 * that one entry staying English whatever the interface language is.
 *
 * The shared setup resets the language between tests, so the French case
 * below does not leak into the others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import { resetAdminStatus } from '../../hooks/useIsAdmin'
import { i18n } from '../../i18n'
import * as runtimeConfig from '../../runtime-config'
import ShellMenu from './ShellMenu'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderMenu = (authed: boolean, isAdmin = false, at = '/') => {
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
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider>
        <ShellMenu />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setAccessToken(null)
  resetAdminStatus()
  // The feedback entry is gated on the server being able to send mail; most
  // cases here want it present, and the one that does not says so.
  vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

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

  it('links to account settings, right after Profile', async () => {
    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const settings = await screen.findByRole('menuitem', {
      name: 'Account settings',
    })
    expect(settings).toHaveAttribute('href', '/app/settings')
    const labels = screen
      .getAllByRole('menuitem')
      .map(el => el.textContent?.trim())
    expect(labels.slice(0, 3)).toEqual(['Home', 'Profile', 'Account settings'])
  })

  it('offers Log in instead of Profile/Account settings/Log out when signed out', () => {
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
    expect(
      screen.queryByRole('menuitem', { name: 'Account settings' }),
    ).not.toBeInTheDocument()
  })

  it('lists the static pages between Account settings and Admin', async () => {
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('menuitem', { name: 'Admin' })
    const labels = screen
      .getAllByRole('menuitem')
      .map(el => el.textContent?.trim())
    expect(labels).toEqual([
      'Home',
      'Profile',
      'Account settings',
      'About us',
      'Send feedback',
      'Privacy policy',
      'Terms & conditions',
      'Admin',
      'Log out',
    ])
  })

  it('points each static entry at its page', async () => {
    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const href = async (name: string) =>
      (await screen.findByRole('menuitem', { name })).getAttribute('href')
    expect(await href('About us')).toBe('/about')
    expect(await href('Send feedback')).toBe('/feedback')
    expect(await href('Privacy policy')).toBe('/privacy')
    expect(await href('Terms & conditions')).toBe('/terms')
  })

  // A policy that needs an account to read is not a policy, and someone who
  // cannot sign in is exactly who needs the feedback form.
  it('offers the static pages when signed out too', () => {
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const labels = screen
      .getAllByRole('menuitem')
      .map(el => el.textContent?.trim())
    expect(labels).toEqual([
      'Home',
      'Log in',
      'About us',
      'Send feedback',
      'Privacy policy',
      'Terms & conditions',
    ])
  })

  // Nothing else in the group depends on mail, so only that one entry goes —
  // and its group's rule stays, because About us is still in it.
  it('drops Send feedback when the server cannot send mail', () => {
    vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(false)
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(
      screen.queryByRole('menuitem', { name: 'Send feedback' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'About us' })).toBeVisible()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  // The static pages are English-only documents (content/document.ts), so
  // the way in stays English as well — the same call as the Admin entry.
  it('keeps the static entries English in a translated interface', async () => {
    await i18n.changeLanguage('fr')
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: 'Accueil' })).toBeVisible()
    expect(
      screen.getByRole('menuitem', { name: 'Privacy policy' }),
    ).toBeVisible()
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

  it('keeps the closed panel out of the accessibility tree', async () => {
    renderMenu(true)
    // Still mounted, so it has something to slide out — but hidden, so
    // nothing in it is reachable by pointer, keyboard or screen reader
    const panel = document.querySelector('[role="menu"]')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(panel).toHaveAttribute('inert')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Home' }),
    ).not.toBeInTheDocument()
  })

  it('fences the Admin entry with separators, for admins only', async () => {
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const admin = await screen.findByRole('menuitem', { name: 'Admin' })
    // Two above the static pages, then one directly above the Admin entry
    // and one directly below it
    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(4)
    const items = Array.from(screen.getByRole('menu').children)
    const at = (el: Element) => items.indexOf(el)
    const entry = at(admin.closest('.relative')!)
    expect(at(separators[2]!)).toBe(entry - 1)
    expect(at(separators[3]!)).toBe(entry + 1)
  })

  it('leaves out the Admin separators when there is no Admin entry', async () => {
    renderMenu(true, false)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('menuitem', { name: 'Profile' })
    // Only the two the static-page groups bring with them
    await vi.waitFor(() =>
      expect(screen.getAllByRole('separator')).toHaveLength(2),
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
    expect(
      screen.getByRole('menuitem', { name: 'Admin Logs' }),
    ).toHaveAttribute('href', '/app/admin/logs')

    fireEvent.mouseLeave(trigger.parentElement!)
    expect(
      screen.queryByRole('menuitem', { name: 'Users' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the Admin entry English in a translated interface', async () => {
    await i18n.changeLanguage('fr')
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    // The rest of the menu follows the interface language…
    expect(screen.getByRole('menuitem', { name: 'Accueil' })).toBeVisible()
    // …but the way into the English-only console does not (docs/I18N.md)
    const trigger = await screen.findByRole('menuitem', { name: 'Admin' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'Admin' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Admin Logs' })).toBeVisible()
  })

  it('toggles the Admin submenu on click for keyboard and touch', async () => {
    renderMenu(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const trigger = await screen.findByRole('menuitem', { name: 'Admin' })

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Admin Logs' })).toBeVisible()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('menuitem', { name: 'Admin Logs' }),
    ).not.toBeInTheDocument()
  })
})
