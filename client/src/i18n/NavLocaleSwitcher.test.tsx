/**
 * Unit tests for the public nav's language picker: the pages a signed-out
 * visitor can land on offer it, it lands in the nav's action area rather
 * than the page body, and it stays a page-level choice — the shell itself
 * does not put one on every public route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'
import { applyLocale } from './index'
import { LOCALE_STORAGE_KEY } from './detect'
import { ShellActionsProvider } from '../components/layout/ShellActions'
import PublicShell from '../components/layout/PublicShell'
import LandingPage from '../pages/LandingPage'
import LoginPage from '../pages/LoginPage'
import RegisterPage from '../pages/RegisterPage'

/** Anonymous visitor: the refresh call is what settles auth to signed-out. */
const anonymous = () =>
  mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })

// The trigger names itself "Interface language: <current choice>"
const SWITCHER = { name: /Interface language/ }

beforeEach(() => {
  setAccessToken(null)
  localStorage.clear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  // The i18next instance is a module singleton: a test that switches
  // language would otherwise hand French to the next one
  await applyLocale('en')
})

describe('NavLocaleSwitcher', () => {
  it.each([
    ['landing', '/', <LandingPage />],
    ['sign-in', '/login', <LoginPage />],
    ['sign-up', '/register', <RegisterPage />],
  ])('is offered on the %s page', async (_name, path, element) => {
    anonymous()
    render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path={path} element={element} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    // The default, then every supported locale, so a visitor can reach
    // their own language
    fireEvent.click(await screen.findByRole('button', SWITCHER))
    // Each named in itself, with no English gloss
    expect(
      screen.getAllByRole('menuitemradio').map(i => i.textContent),
    ).toEqual([
      "Default — your browser's language",
      'English',
      'Français',
      'Español',
      'Русский',
      '中文',
    ])
  })

  it('starts on the default, and returns to it when picked again', async () => {
    anonymous()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    const trigger = await screen.findByRole('button', SWITCHER)
    fireEvent.click(trigger)
    // Nothing has been chosen, so it is the default that is checked —
    // even though English is what the browser resolved to and is showing
    const defaultItem = () =>
      screen.getByRole('menuitemradio', {
        name: "Default — your browser's language",
      })
    expect(defaultItem()).toBeChecked()
    expect(
      screen.getByRole('menuitemradio', { name: 'English' }),
    ).not.toBeChecked()

    // Each switch has to land before the next one: the bundle load is
    // async, and a second switch started mid-flight would be overtaken
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Français' }))
    await vi.waitFor(() => expect(trigger).toHaveTextContent('Français'))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr')

    // Back to the default: the choice is forgotten, and the browser's
    // language decides again
    fireEvent.click(trigger)
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: /votre navigateur/ }),
    )
    await vi.waitFor(() => expect(trigger).toHaveTextContent('English'))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
    fireEvent.click(trigger)
    expect(defaultItem()).toBeChecked()
  })

  it('labels itself with the chosen language, by its native name', async () => {
    anonymous()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    const trigger = await screen.findByRole('button', SWITCHER)
    expect(trigger).toHaveTextContent('English')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Français' }))

    await vi.waitFor(() => expect(trigger).toHaveTextContent('Français'))
    // Choosing closes the menu
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('sits in the primary nav, not the page body', async () => {
    anonymous()
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ShellActionsProvider>
            <Routes>
              <Route element={<PublicShell />}>
                <Route path="/" element={<LandingPage />} />
              </Route>
            </Routes>
          </ShellActionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('button', SWITCHER)).toBeInTheDocument()
  })

  it('is not added to every public route by the shell itself', async () => {
    anonymous()
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ShellActionsProvider>
            <Routes>
              <Route element={<PublicShell />}>
                <Route path="/" element={<div>PAGE</div>} />
              </Route>
            </Routes>
          </ShellActionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByText('PAGE')
    expect(screen.queryByRole('button', SWITCHER)).not.toBeInTheDocument()
  })
})
