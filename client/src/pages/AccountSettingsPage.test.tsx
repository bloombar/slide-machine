/**
 * Unit tests for the unified account settings page: the owner's own profile
 * fields, account details, visibility toggle, and both languages —
 * then the admin path over the same controls (ADMIN-5), which confirms on
 * entry, loads the target account, saves through the audited endpoint, and
 * drops the owner-only pieces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import AccountSettingsPage from './AccountSettingsPage'
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

/** A usage response with nothing spent, so the panel renders without noise. */
const emptyUsage = {
  tier: 'free',
  period: '2026-08',
  resetAt: '2026-09-01T00:00:00.000Z',
  metrics: [],
}

/** A free account's billing: no subscription, the paid tiers on offer. */
const freeBilling = {
  tier: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canManageBilling: false,
  purchasableTiers: ['fresh', 'pro', 'max'],
}

/** Renders the page at its canonical route, for the signed-in user.
 * `entry` varies the URL, which is where the open tab lives. */
const renderSettings = (
  routes: Record<string, Handler> = {},
  entry = '/app/settings',
) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: user(), accessToken: 't' },
    }),
    '/api/auth/logout': () => ({ status: 204 }),
    '/api/actions/user.usage': () => ({ status: 200, body: emptyUsage }),
    '/api/actions/billing.summary': () => ({ status: 200, body: freeBilling }),
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/app/settings" element={<AccountSettingsPage />} />
          <Route
            path="/app/settings/:userId"
            element={<AccountSettingsPage />}
          />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/u/:userId" element={<div>PROFILE PAGE</div>} />
          <Route path="/" element={<div>LANDING PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('AccountSettingsPage', () => {
  it('shows account details on General and the tier on Plan', async () => {
    renderSettings()
    expect(await screen.findByText('ada@example.com')).toBeVisible()
    // General is what the account is; Plan is what it may spend, so the tier
    // is one tab over rather than mixed in with the bio.
    expect(screen.queryByText('Free')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Plan & Usage' }))

    expect(await screen.findByText('Free')).toBeVisible()
  })

  it('opens the tab named in the URL', async () => {
    // The billing provider sends the browser back here after checkout
    // (BILL-2); landing on General would hide what the user just paid for.
    renderSettings({}, '/app/settings?tab=plan')

    expect(await screen.findByText('Free')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Plan & Usage' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('links from the current plan to where plans are compared', async () => {
    renderSettings({}, '/app/settings?tab=plan')

    // Settings says what the account is on; choosing a different plan means
    // comparing four of them, which is a page rather than a row of buttons.
    const link = await screen.findByRole('link', { name: 'Change plan' })
    expect(link).toHaveAttribute('href', '/app/plans')
    expect(screen.queryByRole('button', { name: /Upgrade to/i })).toBeNull()
  })

  // ADMIN-9. Without this the badge would say Pro with nothing explaining
  // why, and the day it reverts would arrive unannounced.
  it('tells an account holder their plan is complimentary, and until when', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: {
          user: user({
            planTier: 'pro',
            planGrant: {
              tier: 'pro',
              expiresAt: '2026-09-30T23:59:59.999Z',
              revertsTo: 'free',
            },
          }),
          accessToken: 't',
        },
      }),
      '/api/actions/user.usage': () => ({ status: 200, body: emptyUsage }),
      '/api/actions/billing.summary': () => ({
        status: 200,
        body: freeBilling,
      }),
    })
    render(
      <MemoryRouter initialEntries={['/app/settings?tab=plan']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/settings" element={<AccountSettingsPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(/Pro at no charge until .*returns to Free/i),
    ).toBeVisible()
  })

  it('does not offer an admin a link to change someone else’s plan', async () => {
    renderSettings(
      {
        '/api/admin/users/u2': () => ({
          status: 200,
          body: {
            user: user({ id: 'u2', email: 'bob@example.com' }),
            billingTier: 'free',
          },
        }),
      },
      '/app/settings/u2?tab=plan',
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /Edit settings/i }),
    )

    // The subscription is not the admin's to change, and the checkout behind
    // that link would bill the admin's own card.
    expect(await screen.findByText('Free')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Change plan' })).toBeNull()
  })

  it('falls back to General when the URL names no tab it knows', async () => {
    renderSettings({}, '/app/settings?tab=nonsense')

    expect(await screen.findByText('ada@example.com')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('moves between tabs with the arrow keys', async () => {
    renderSettings()
    const general = await screen.findByRole('tab', { name: 'General' })
    expect(general).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(general, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Privacy' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
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

    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy' }))
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

  it('edits the public profile fields in place', async () => {
    // Merged from the profile page: there is one place to change a setting,
    // whichever setting it is.
    let sent: unknown
    renderSettings({
      '/api/actions/user.updateProfile': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: user({ displayName: 'Ada L.' }) }
      },
    })

    const name = await screen.findByLabelText('Display name')
    expect(name).toHaveValue('Ada')
    fireEvent.change(name, { target: { value: 'Ada L.' } })
    // Committed on blur, like every other control here saves as you go —
    // no Save button for these two fields alone.
    fireEvent.blur(name)

    await vi.waitFor(() => expect(sent).toEqual({ displayName: 'Ada L.' }))
  })

  it('saves the bio on its own when it is the field that changed', async () => {
    // One field per commit: leaving the bio must not also re-send a name
    // nobody touched.
    let sent: unknown
    renderSettings({
      '/api/actions/user.updateProfile': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: user({ bio: 'Analytical engines.' }) }
      },
    })

    const bio = await screen.findByLabelText('Bio')
    fireEvent.change(bio, { target: { value: 'Analytical engines.' } })
    fireEvent.blur(bio)

    await vi.waitFor(() => expect(sent).toEqual({ bio: 'Analytical engines.' }))
  })

  it('sends nothing when a field is left exactly as it was', async () => {
    const { fetchMock } = renderSettings()

    const name = await screen.findByLabelText('Display name')
    fireEvent.change(name, { target: { value: 'Ada' } })
    fireEvent.blur(name)

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('user.updateProfile'),
      ),
    ).toBe(false)
  })

  it('refuses to save an empty display name', async () => {
    renderSettings()

    const name = await screen.findByLabelText('Display name')
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.blur(name)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /display name is required/i,
    )
  })

  it('redirects the long form of your own settings to the canonical route', async () => {
    // /app/settings/:you and /app/settings are the same page; only one of
    // them is the URL people should end up sharing.
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: user(), accessToken: 't' },
      }),
      '/api/actions/user.usage': () => ({ status: 200, body: emptyUsage }),
      '/api/actions/billing.summary': () => ({
        status: 200,
        body: freeBilling,
      }),
    })
    render(
      <MemoryRouter initialEntries={['/app/settings/u1']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/app/settings"
              element={<div>CANONICAL SETTINGS</div>}
            />
            <Route
              path="/app/settings/:userId"
              element={<AccountSettingsPage />}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('CANONICAL SETTINGS')).toBeInTheDocument()
  })

  it('closes the account from the danger zone, then signs out', async () => {
    // A soft delete (P-10): recoverable for a window, but the session ends
    // at once, so the user lands somewhere public rather than holding a
    // token for an account that no longer reads as live.
    let called = false
    renderSettings({
      '/api/actions/user.deleteAccount': () => {
        called = true
        return { status: 200, body: { deleted: true } }
      },
    })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete account' }),
    )
    // The dialog's confirm carries the same words as the trigger, so pick the
    // one the dialog added rather than the one that opened it.
    const buttons = await screen.findAllByRole('button', {
      name: 'Delete account',
    })
    fireEvent.click(buttons[buttons.length - 1]!)

    await vi.waitFor(() => expect(called).toBe(true))
    expect(await screen.findByText('LANDING PAGE')).toBeInTheDocument()
  })

  it('deletes nothing until the confirmation is accepted', async () => {
    const { fetchMock } = renderSettings()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete account' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('user.deleteAccount'),
      ),
    ).toBe(false)
  })

  it('offers no sign out — it lives in the shell menu, on every page', async () => {
    renderSettings()

    await screen.findByRole('tab', { name: 'Plan & Usage' })
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Plan & Usage' }))
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
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

describe('AccountSettingsPage as an admin (ADMIN-5)', () => {
  const target = user({
    id: 'u9',
    displayName: 'Grace',
    email: 'grace@example.com',
    planTier: 'pro',
    locale: 'fr',
  })

  /** Renders another user's settings as an admin, past the entry
   * confirmation — ADMIN-5 asks once, and every test below is about what
   * happens after that. `confirm: false` stops short of it. */
  const renderAsAdmin = async (
    routes: Record<string, Handler> = {},
    { confirm = true } = {},
  ) => {
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
        body: {
          user: target,
          projectCount: 1,
          deckCount: 2,
          banned: false,
          billingTier: 'pro',
        },
      }),
      ...routes,
    })
    render(
      <MemoryRouter initialEntries={['/app/settings/u9']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/settings" element={<AccountSettingsPage />} />
            <Route
              path="/app/settings/:userId"
              element={<AccountSettingsPage />}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    if (confirm) {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Edit settings' }),
      )
    }
    return mock
  }

  /** The PATCH bodies sent so far, as raw JSON strings. */
  const patchBodies = (
    fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock'],
  ) =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => String(init?.body))

  it("shows the target's account behind the audit banner", async () => {
    await renderAsAdmin()
    expect(await screen.findByText('grace@example.com')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Plan & Usage' }))
    expect(await screen.findByText('Pro')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      /editing another user's account as an admin/i,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /recorded in the audit log/i,
    )
  })

  it('asks before showing another user’s settings, and leaves if declined', async () => {
    // ADMIN-5 confirms on entry, once. Declining must not reveal the account.
    await renderAsAdmin({}, { confirm: false })

    expect(
      await screen.findByRole('heading', {
        name: "Edit this user's settings?",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('grace@example.com')).toBeNull()
  })

  it('edits the target’s profile fields through the audited endpoint', async () => {
    const { fetchMock } = await renderAsAdmin({
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

    const name = await screen.findByLabelText('Display name')
    expect(name).toHaveValue('Grace')
    fireEvent.change(name, { target: { value: 'Grace H.' } })
    fireEvent.blur(name)

    await vi.waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual(['{"displayName":"Grace H."}']),
    )
    // The owner's own action is never used for someone else's account.
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('user.updateProfile'),
      ),
    ).toBe(false)
  })

  it('offers no account deletion for someone else’s account', async () => {
    // An admin closing an account goes through the admin surfaces, where it
    // is recorded against them.
    await renderAsAdmin()
    await screen.findByText('grace@example.com')

    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  // ADMIN-9. The plan is the one thing on this page an admin can change that
  // the owner cannot, so it appears only on the admin's path through it.
  it('offers a complimentary plan on the Plan tab', async () => {
    await renderAsAdmin()
    await screen.findByText('grace@example.com')
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))

    expect(await screen.findByText('Complimentary plan')).toBeVisible()
    // Grace pays for Pro, so only Max is left to give.
    expect(
      screen.getAllByRole('option').map(o => (o as HTMLOptionElement).value),
    ).toEqual(['max'])
  })

  it('re-reads the account after granting a plan', async () => {
    let granted = false
    // One handler for both verbs: the mock matches on a URL fragment, and
    // `/plan-grant` hangs off the same path as the account itself.
    const { fetchMock } = await renderAsAdmin({
      '/api/admin/users/u9': init => {
        if (init?.method === 'PUT') {
          granted = true
          return { status: 204 }
        }
        return {
          status: 200,
          body: {
            user: { ...target, planTier: granted ? 'max' : 'pro' },
            projectCount: 1,
            deckCount: 2,
            banned: false,
            billingTier: 'pro',
            planGrant: granted
              ? {
                  tier: 'max',
                  expiresAt: '2026-09-30T23:59:59.999Z',
                  grantedAt: '2026-08-01T00:00:00.000Z',
                  grantedByEmail: 'root@example.com',
                  inEffect: true,
                }
              : undefined,
          },
        }
      },
    })
    await screen.findByText('grace@example.com')
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))

    fireEvent.change(await screen.findByLabelText('Last day'), {
      target: { value: '2026-09-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }))

    // The endpoint answers 204 and the effective tier is the server's to
    // decide, so the page re-reads rather than predicting it.
    expect(await screen.findByText('Max')).toBeVisible()
    expect(await screen.findByText(/Complimentary Max until/)).toBeVisible()
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/admin/users/u9'),
      ),
    ).toHaveLength(2)
  })

  it('shows no usage panel for someone else’s account', async () => {
    // The usage action reports the *caller's* account, so rendering it here
    // would print the admin's numbers under another person's name.
    await renderAsAdmin()
    await screen.findByText('grace@example.com')
    fireEvent.click(screen.getByRole('tab', { name: 'Plan & Usage' }))

    expect(screen.queryByTestId('usage-panel')).toBeNull()
  })

  it('offers no sign out, the same as the owner’s own view', async () => {
    await renderAsAdmin()
    await screen.findByText('grace@example.com')
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })

  it('saves profile visibility through the audited endpoint', async () => {
    const { fetchMock } = await renderAsAdmin({
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

    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy' }))
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
    const { fetchMock } = await renderAsAdmin({
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
    const { fetchMock } = await renderAsAdmin({
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
    await renderAsAdmin({
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

    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy' }))
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Public profile' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admin accounts cannot be moderated',
    )
  })

  it('reports an account it cannot load', async () => {
    await renderAsAdmin({ '/api/admin/users/u9': () => ({ status: 403 }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this account.',
    )
  })
})
