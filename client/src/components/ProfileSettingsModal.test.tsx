/**
 * Unit tests for the account settings modal reached from the profile
 * page: account details, the profile-visibility toggle, the lecturing
 * language, and sign out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import ProfileSettingsModal from './ProfileSettingsModal'
import { mockFetchRoutes } from '../test/fetch-mock'

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  ...over,
})

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

const renderSettings = (routes: Record<string, Handler> = {}) => {
  const onClose = vi.fn()
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: user(), accessToken: 't' },
    }),
    '/api/auth/logout': () => ({ status: 204 }),
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/u/u1']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/u/:userId"
            element={<ProfileSettingsModal onClose={onClose} />}
          />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { onClose }
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('ProfileSettingsModal', () => {
  it('shows account details and plan tier', async () => {
    renderSettings()
    expect(await screen.findByText('ada@example.com')).toBeVisible()
    expect(screen.getByText('free')).toBeVisible()
  })

  it('toggles profile visibility', async () => {
    let sent: unknown
    renderSettings({
      '/api/actions/user.setProfileVisibility': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: user({ profileVisibility: 'private' }),
        }
      },
    })

    const toggle = await screen.findByRole('checkbox', {
      name: 'Public profile',
    })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await vi.waitFor(() =>
      expect(sent).toEqual({ profileVisibility: 'private' }),
    )
    await vi.waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('saves an explicit lecture language and clears back to default', async () => {
    let sent: unknown
    renderSettings({
      '/api/actions/user.setLanguage': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: user({ language: 'fr' }) }
      },
    })
    const select = await screen.findByRole('combobox', { name: 'Language' })
    // Nothing stored: the browser-default option is selected
    expect(select).toHaveValue('')

    fireEvent.change(select, { target: { value: 'fr' } })
    await vi.waitFor(() => expect(sent).toEqual({ language: 'fr' }))
    // The saved user round-trips into the select via the auth context
    await vi.waitFor(() => expect(select).toHaveValue('fr'))

    // Choosing the default option clears the stored value (null)
    fireEvent.change(select, { target: { value: '' } })
    await vi.waitFor(() => expect(sent).toEqual({ language: null }))
  })

  it('signs out and redirects to login', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('closes from the close button', async () => {
    const { onClose } = renderSettings()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Close settings' }),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
