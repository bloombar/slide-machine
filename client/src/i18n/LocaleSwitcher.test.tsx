/**
 * Unit tests for the interface-language switcher: it re-translates the
 * app immediately, remembers an explicit choice locally, and — signed in
 * — persists it to the account so another browser starts in the same
 * language. Until one is made it stays on the default, which stores
 * nothing and follows the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LOCALES } from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'
import LocaleSwitcher from './LocaleSwitcher'
import { applyLocale } from './index'
import { LOCALE_STORAGE_KEY } from './detect'

/** An account that never picked a language stores no `locale` at all. */
const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  ...over,
})

const DEFAULT_OPTION = "Default — your browser's language"

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

/** Renders the switcher, signed in or anonymous. */
const renderSwitcher = (
  {
    signedIn = true,
    account = {},
  }: { signedIn?: boolean; account?: Record<string, unknown> } = {},
  routes: Record<string, Handler> = {},
) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () =>
      signedIn
        ? { status: 200, body: { user: user(account), accessToken: 't' } }
        : {
            status: 401,
            body: { error: { code: 'unauthorized', message: '' } },
          },
    ...routes,
  })
  render(
    <MemoryRouter>
      <AuthProvider>
        <LocaleSwitcher />
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

beforeEach(() => {
  setAccessToken(null)
  localStorage.clear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  // The i18next instance is a module singleton: a test that switches
  // language would otherwise hand Russian to the next one
  await applyLocale('en')
})

describe('LocaleSwitcher', () => {
  it('lists the default plus every supported locale under its own name', async () => {
    renderSwitcher()
    const select = await screen.findByRole('combobox', {
      name: 'Interface language',
    })
    // The empty value is the default — no stored choice — and the rest
    // come from LOCALES, so a newly supported language needs no edit here
    expect([...select.querySelectorAll('option')].map(o => o.value)).toEqual([
      '',
      ...LOCALES,
    ])
    // Native names, not English ones — that is what a reader scans for
    expect(screen.getByRole('option', { name: /Français/ })).toBeInTheDocument()
  })

  it('starts on the default when the account never chose a language', async () => {
    renderSwitcher()
    const select = await screen.findByRole('combobox', {
      name: 'Interface language',
    })
    // The default option is what is selected, even though English is
    // what the browser resolved to and what the app is showing
    expect(select).toHaveValue('')
    expect(
      screen.getByRole('option', { name: DEFAULT_OPTION }),
    ).toBeInTheDocument()
  })

  it('shows the language the account did choose', async () => {
    renderSwitcher({ account: { locale: 'ru' } })
    // The label follows the account into Russian, so the select is found
    // by role alone
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveValue('ru'),
    )
  })

  it('remembers the choice and persists it to the account', async () => {
    let sent: unknown
    renderSwitcher(
      {},
      {
        '/api/actions/user.setLocale': init => {
          sent = JSON.parse(String(init?.body))
          return { status: 200, body: user({ locale: 'es' }) }
        },
      },
    )

    const select = await screen.findByRole('combobox', {
      name: 'Interface language',
    })
    fireEvent.change(select, { target: { value: 'es' } })

    await vi.waitFor(() => expect(sent).toEqual({ locale: 'es' }))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })

  it('clears the choice back to the browser default', async () => {
    let sent: unknown
    renderSwitcher(
      { account: { locale: 'es' } },
      {
        '/api/actions/user.setLocale': init => {
          sent = JSON.parse(String(init?.body))
          return { status: 200, body: user() }
        },
      },
    )

    const select = await screen.findByRole('combobox')
    await vi.waitFor(() => expect(select).toHaveValue('es'))
    fireEvent.change(select, { target: { value: '' } })

    // null is what clears the account's stored locale; the browser is
    // what decides from here, on this visit and every later one
    await vi.waitFor(() => expect(sent).toEqual({ locale: null }))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
    await vi.waitFor(() => expect(select).toHaveValue(''))
  })

  it('still switches for an anonymous visitor, without an account write', async () => {
    const { calls } = renderSwitcher({ signedIn: false })

    const select = await screen.findByRole('combobox', {
      name: 'Interface language',
    })
    fireEvent.change(select, { target: { value: 'ru' } })

    await vi.waitFor(() =>
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru'),
    )
    // Nothing to persist to: there is no account yet, and localStorage
    // carries the choice into the next visit's pre-auth paint.
    expect(calls.some(url => url.includes('setLocale'))).toBe(false)
  })
})
