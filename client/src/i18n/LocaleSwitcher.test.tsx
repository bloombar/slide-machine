/**
 * Unit tests for the interface-language switcher: it re-translates the
 * app immediately, remembers the choice locally, and — signed in —
 * persists it to the account so another browser starts in the same
 * language.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'
import LocaleSwitcher from './LocaleSwitcher'
import { LOCALE_STORAGE_KEY } from './detect'

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  locale: 'en',
  ...over,
})

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

/** Renders the switcher, signed in or anonymous. */
const renderSwitcher = (
  { signedIn = true }: { signedIn?: boolean } = {},
  routes: Record<string, Handler> = {},
) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () =>
      signedIn
        ? { status: 200, body: { user: user(), accessToken: 't' } }
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
afterEach(() => vi.unstubAllGlobals())

describe('LocaleSwitcher', () => {
  it('lists every supported locale under its own name', async () => {
    renderSwitcher()
    const select = await screen.findByRole('combobox', {
      name: 'Interface language',
    })
    expect([...select.querySelectorAll('option')].map(o => o.value)).toEqual([
      'en',
      'fr',
      'es',
      'ru',
      'zh',
    ])
    // Native names, not English ones — that is what a reader scans for
    expect(screen.getByRole('option', { name: /Français/ })).toBeInTheDocument()
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
