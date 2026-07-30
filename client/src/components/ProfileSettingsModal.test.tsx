/**
 * Unit tests for the account settings modal reached from the profile
 * page: the owner's own account details, the profile-visibility toggle,
 * the lecturing language, and sign out — then the admin path over the
 * same controls (ADMIN-5), which loads the target account, saves through
 * the audited endpoint, and drops the owner-only pieces.
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
  locale: 'en',
  ...over,
})

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

/** Renders the modal for the signed-in user's own account. */
const renderSettings = (routes: Record<string, Handler> = {}) => {
  const onClose = vi.fn()
  const mock = mockFetchRoutes({
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
  return { onClose, ...mock }
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

  it('switches the interface language and persists it to the account', async () => {
    let sent: unknown
    renderSettings({
      '/api/actions/user.setLocale': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: user({ locale: 'fr' }) }
      },
    })

    const select = await screen.findByLabelText('Interface language')
    expect(select).toHaveValue('en')
    fireEvent.change(select, { target: { value: 'fr' } })

    await vi.waitFor(() => expect(sent).toEqual({ locale: 'fr' }))
    await vi.waitFor(() => expect(select).toHaveValue('fr'))
  })
})

describe('ProfileSettingsModal as an admin (ADMIN-5)', () => {
  const target = user({
    id: 'u9',
    displayName: 'Grace',
    email: 'grace@example.com',
    planTier: 'pro',
    locale: 'fr',
  })

  /** Renders the modal against another user's account, as an admin. */
  const renderAsAdmin = (routes: Record<string, Handler> = {}) => {
    const onClose = vi.fn()
    const mock = mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: {
          user: user({ id: 'root', email: 'root@example.com' }),
          accessToken: 't',
        },
      }),
      '/api/admin/users/u9': () => ({
        status: 200,
        body: { user: target, projectCount: 1, deckCount: 2, banned: false },
      }),
      ...routes,
    })
    render(
      <MemoryRouter initialEntries={['/u/u9']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/u/:userId"
              element={
                <ProfileSettingsModal adminUserId="u9" onClose={onClose} />
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    return { onClose, ...mock }
  }

  /** The PATCH bodies sent so far, as raw JSON strings. */
  const patchBodies = (
    fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock'],
  ) =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => String(init?.body))

  it("shows the target's account behind the audit banner", async () => {
    renderAsAdmin()
    expect(await screen.findByText('grace@example.com')).toBeVisible()
    expect(screen.getByText('pro')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      /editing another user's account as an admin/i,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /recorded in the audit log/i,
    )
  })

  it('offers no sign out — that would end the admin’s own session', async () => {
    renderAsAdmin()
    await screen.findByText('grace@example.com')
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })

  it('saves profile visibility through the audited endpoint', async () => {
    const { fetchMock } = renderAsAdmin({
      '/api/admin/users/u9': init =>
        init?.method === 'PATCH'
          ? { status: 204 }
          : {
              status: 200,
              body: {
                user: target,
                projectCount: 1,
                deckCount: 2,
                banned: false,
              },
            },
    })

    const toggle = await screen.findByRole('checkbox', {
      name: 'Public profile',
    })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await vi.waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([
        '{"profileVisibility":"private"}',
      ]),
    )
    // The landed value is folded in, so the control reflects it
    await vi.waitFor(() => expect(toggle).not.toBeChecked())
    // The owner's own action is never used for someone else's account
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('user.setProfileVisibility'),
      ),
    ).toBe(false)
  })

  it('sets and clears the lecturing language, clearing as an explicit null', async () => {
    const { fetchMock } = renderAsAdmin({
      '/api/admin/users/u9': init =>
        init?.method === 'PATCH'
          ? { status: 204 }
          : {
              status: 200,
              body: {
                user: { ...target, language: 'es' },
                projectCount: 0,
                deckCount: 0,
                banned: false,
              },
            },
    })

    const select = await screen.findByRole('combobox', { name: 'Language' })
    expect(select).toHaveValue('es')

    fireEvent.change(select, { target: { value: 'ru' } })
    await vi.waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual(['{"language":"ru"}']),
    )
    await vi.waitFor(() => expect(select).toHaveValue('ru'))

    fireEvent.change(select, { target: { value: '' } })
    await vi.waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([
        '{"language":"ru"}',
        '{"language":null}',
      ]),
    )
    await vi.waitFor(() => expect(select).toHaveValue(''))
  })

  it('edits the interface language on the target account', async () => {
    const { fetchMock } = renderAsAdmin({
      '/api/admin/users/u9': init =>
        init?.method === 'PATCH'
          ? { status: 204 }
          : {
              status: 200,
              body: {
                user: target,
                projectCount: 0,
                deckCount: 0,
                banned: false,
              },
            },
    })

    const select = await screen.findByLabelText('Interface language')
    expect(select).toHaveValue('fr')
    fireEvent.change(select, { target: { value: 'en' } })

    await vi.waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual(['{"locale":"en"}']),
    )
    await vi.waitFor(() => expect(select).toHaveValue('en'))
  })

  it('reports a refused save rather than reverting quietly', async () => {
    renderAsAdmin({
      '/api/admin/users/u9': init =>
        init?.method === 'PATCH'
          ? {
              status: 400,
              body: {
                error: {
                  code: 'target_is_admin',
                  message: 'Admin accounts cannot be moderated',
                },
              },
            }
          : {
              status: 200,
              body: {
                user: target,
                projectCount: 0,
                deckCount: 0,
                banned: false,
              },
            },
    })

    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Public profile' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admin accounts cannot be moderated',
    )
  })

  it('reports an account it cannot load', async () => {
    renderAsAdmin({ '/api/admin/users/u9': () => ({ status: 403 }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this account.',
    )
  })
})
