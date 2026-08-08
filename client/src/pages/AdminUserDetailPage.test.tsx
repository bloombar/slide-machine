/**
 * Unit tests for the per-user admin view: the read-only account details
 * and their pointer to the profile page, where the settings are actually
 * edited (ADMIN-5); projects linking to their admin project pages; the
 * "Other lectures" group for decks living outside the user's own
 * projects; and the moderation actions (delete user/project/lecture,
 * ban/unban email, reset password). Soft-deleted content is covered too:
 * the badge, the recovery actions that replace moderation, and the product
 * links that are withdrawn (ADMIN-6).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AdminUserDetailPage from './AdminUserDetailPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const detail = {
  user: {
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    emailVerified: true,
    profileVisibility: 'public',
    locale: 'en',
    planTier: 'pro',
    bio: 'Lecturer',
    createdAt: '2026-07-01T12:00:00Z',
  },
  projectCount: 1,
  deckCount: 2,
  banned: false,
  billingTier: 'pro',
}

const projects = [
  {
    id: 'p1',
    title: 'Physics',
    ownerId: 'u1',
    updatedAt: '2026-07-01T00:00:00Z',
  },
]

const decks = [
  {
    id: 'd1',
    projectId: 'p1',
    title: 'Waves',
    permalinkSlug: 'waves-abc123',
    visibility: 'public',
    slideCount: 5,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-03T00:00:00Z',
  },
  {
    id: 'd2',
    projectId: 'p-foreign',
    title: '',
    permalinkSlug: 'untitled-xyz789',
    visibility: 'restricted',
    slideCount: 0,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
  },
]

const renderPage = (status = 200, detailBody: unknown = detail) => {
  // Keys ordered most-specific first: the fetch mock matches by substring
  const mocks = mockFetchRoutes({
    '/api/admin/users/u1/projects': () => ({ status, body: { projects } }),
    '/api/admin/users/u1/decks': () => ({ status, body: { decks } }),
    '/api/admin/users/u1/ban': () => ({ status: 204 }),
    '/api/admin/users/u1/password': () => ({ status: 204 }),
    '/api/admin/projects/p1': () => ({ status: 204 }),
    '/api/admin/decks/d2': () => ({ status: 204 }),
    // Serves GET (detail) and DELETE (delete user)
    '/api/admin/users/u1': init => {
      if (init?.method === 'DELETE') return { status: 204 }
      return { status, body: detailBody }
    },
  })
  render(
    <MemoryRouter initialEntries={['/app/admin/users/u1']}>
      <Routes>
        <Route
          path="/app/admin/users/:userId"
          element={<AdminUserDetailPage />}
        />
        <Route path="/app/admin" element={<p>users list</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return mocks
}

/** The method+url pairs fetched so far. */
const requested = (
  fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock'],
) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminUserDetailPage', () => {
  // ADMIN-9. The Plan row has to answer two questions at once: what the
  // account may spend, and whether anyone is paying for it.
  it('explains a complimentary plan and what it reverts to', async () => {
    renderPage(200, {
      ...detail,
      user: { ...detail.user, planTier: 'max' },
      billingTier: 'pro',
      planGrant: {
        tier: 'max',
        expiresAt: '2026-09-30T23:59:59.999Z',
        grantedAt: '2026-08-01T00:00:00.000Z',
        grantedByEmail: 'admin@example.com',
        inEffect: true,
      },
    })

    expect(
      await screen.findByText(/max — complimentary until .*, then pro/i),
    ).toBeVisible()
  })

  // History, not clutter: a lapsed grant is what explains last month's usage.
  it('names a lapsed grant without implying it still applies', async () => {
    renderPage(200, {
      ...detail,
      planGrant: {
        tier: 'max',
        expiresAt: '2026-07-30T23:59:59.999Z',
        grantedAt: '2026-07-01T00:00:00.000Z',
        grantedByEmail: 'admin@example.com',
        inEffect: false,
      },
    })

    expect(
      await screen.findByText(/pro \(complimentary max ended/i),
    ).toBeVisible()
  })

  it('shows account details and a public-profile link', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
    expect(screen.getByText('ada@example.com')).toBeVisible()
    expect(screen.getByText('pro')).toBeVisible()
    const details = screen
      .getByRole('heading', { name: 'Details' })
      .closest('section')!
    expect(within(details).getByText('Lecturer')).toBeVisible()
    // The profile fields are listed here too, read-only
    expect(within(details).getByText('English')).toBeVisible()
    expect(within(details).getByText('Ada')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'View public profile' }),
    ).toHaveAttribute('href', '/u/u1')
  })

  it('edits no settings of its own, pointing at Account Settings', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Ada' })

    // No editor: settings are changed on the owner's own settings page (ADMIN-5)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(screen.getByText(/Settings are edited on the user/)).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Account Settings' }),
    ).toHaveAttribute('href', '/app/settings/u1')
  })

  it('links each project to its admin project page', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /Physics/ })
    expect(link).toHaveAttribute('href', '/app/admin/projects/p1')
  })

  it("shows each other lecture's visibility badge and slide count", async () => {
    renderPage()
    const other = await screen.findByText('Other lectures')
    fireEvent.click(other)
    const untitledRow = screen
      .getByRole('link', { name: 'Untitled lecture' })
      .closest('tr')!
    expect(within(untitledRow).getByText('Private')).toBeVisible()
    expect(within(untitledRow).getByText('0')).toBeVisible()
  })

  it('dates a project by its most recent lecture edit', async () => {
    renderPage()
    // The project itself last changed 2026-07-01, but its lecture was
    // edited 2026-07-03 — the newer date wins.
    const updated = new Date('2026-07-03T00:00:00Z').toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    expect(
      await screen.findByText(new RegExp(`updated ${updated}`)),
    ).toBeVisible()
  })

  it('groups decks outside the user\'s projects under "Other lectures"', async () => {
    renderPage()
    const other = await screen.findByText('Other lectures')
    fireEvent.click(other)
    expect(
      screen.getByRole('link', { name: 'Untitled lecture' }),
    ).toHaveAttribute('href', '/app/admin/decks/d2')
  })

  it('shows an error state when a request fails', async () => {
    renderPage(500)
    expect(await screen.findByText('Could not load this user.')).toBeVisible()
  })

  it('links back to the admin users list', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.getByRole('link', { name: '← All users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })

  it('keeps the back link visible when the load fails', async () => {
    renderPage(500)
    await screen.findByText('Could not load this user.')
    expect(screen.getByRole('link', { name: '← All users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })

  it('shows the Banned badge and an Unban button for a banned user', async () => {
    renderPage(200, { ...detail, banned: true })
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.getByText('Banned')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Unban email' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Ban email' }),
    ).not.toBeInTheDocument()
  })

  it('unbans the email after a confirm and reports it', async () => {
    const { fetchMock } = renderPage(200, { ...detail, banned: true })
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Unban email' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Unban this email?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unban email' }))

    expect(await screen.findByText('Email unbanned.')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/users\/u1\/ban$/),
    )
  })

  it('deletes the user after a confirm and returns to the list', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this user?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText('users list')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/users\/u1$/),
    )
  })

  it('does nothing when the confirm dialog is cancelled', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(
      requested(fetchMock).filter(r => r.startsWith('DELETE')),
    ).toHaveLength(0)
  })

  it('bans the email after a confirm and reports it', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Ban email' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Ban this email?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ban email' }))

    expect(
      await screen.findByText('Email banned; all sessions signed out.'),
    ).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/users\/u1\/ban$/),
    )
  })

  it('resets the password through the dialog, enforcing the length floor', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const input = screen.getByLabelText('New password')

    fireEvent.change(input, { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(
      await screen.findByText('Password must be at least 8 characters'),
    ).toBeVisible()
    expect(
      requested(fetchMock).filter(r => r.includes('/password')),
    ).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'brand-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(
      await screen.findByText('Password updated; all sessions signed out.'),
    ).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/users\/u1\/password$/),
    )
  })

  it('deletes a project from its summary row after a confirm', async () => {
    const { fetchMock } = renderPage()
    await screen.findByText('Physics')

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete project Physics' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this project?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete project' }),
    )

    expect(
      await screen.findByText(
        'Project deleted; you can restore it from this page.',
      ),
    ).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/projects\/p1$/),
    )
  })

  it('deletes a lecture from its table row after a confirm', async () => {
    const { fetchMock } = renderPage()
    const other = await screen.findByText('Other lectures')
    fireEvent.click(other)

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete lecture Untitled lecture' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete lecture' }),
    )

    expect(
      await screen.findByText(
        'Lecture deleted; you can restore it from this page.',
      ),
    ).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/decks\/d2$/),
    )
  })
})

// ADMIN-6: soft-deleted content stays listed here, badged, with recovery
// in place of moderation.
describe('AdminUserDetailPage soft-deleted content', () => {
  it('badges a deleted account, withdraws moderation, and offers a restore', async () => {
    renderPage(200, { ...detail, deletedAt: '2026-07-20T09:00:00Z' })
    await screen.findByRole('heading', { name: 'Ada' })

    expect(screen.getByText('Deleted')).toBeVisible()
    expect(screen.getByText(/This account is deleted/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Restore user' })).toBeEnabled()
    // Nothing here moderates a tombstoned account — the endpoints refuse it.
    for (const name of [
      'Delete user',
      'Ban email',
      'Unban email',
      'Reset password',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    // The profile still opens, relabelled for what it now is (ADMIN-6) —
    // so the "public" link is gone, but a product surface remains.
    expect(
      screen.queryByRole('link', { name: 'View public profile' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View deleted profile' }),
    ).toHaveAttribute('href', '/u/u1')
    expect(screen.queryByText(/Settings are edited on the user/)).toBeNull()
  })

  it('restores the account after a confirm and reports it', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/users/u1/projects': () => ({
        status: 200,
        body: { projects },
      }),
      '/api/admin/users/u1/decks': () => ({ status: 200, body: { decks } }),
      '/api/admin/users/u1/restore': () => ({ status: 204 }),
      '/api/admin/users/u1': () => ({
        status: 200,
        body: { ...detail, deletedAt: '2026-07-20T09:00:00Z' },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/users/u1']}>
        <Routes>
          <Route
            path="/app/admin/users/:userId"
            element={<AdminUserDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Ada' })

    fireEvent.click(screen.getByRole('button', { name: 'Restore user' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Restore this user?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Restore user' }),
    )

    expect(await screen.findByText('Account restored.')).toBeVisible()
    expect(requested(mocks.fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/users\/u1\/restore$/),
    )
  })

  it('badges a deleted project row and swaps its action for Restore', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/users/u1/projects': () => ({
        status: 200,
        body: {
          projects: [{ ...projects[0]!, deletedAt: '2026-07-20T09:00:00Z' }],
        },
      }),
      '/api/admin/users/u1/decks': () => ({ status: 200, body: { decks: [] } }),
      '/api/admin/projects/p1/restore': () => ({ status: 204 }),
      '/api/admin/users/u1': () => ({ status: 200, body: detail }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/users/u1']}>
        <Routes>
          <Route
            path="/app/admin/users/:userId"
            element={<AdminUserDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    const row = (await screen.findByRole('link', { name: /Physics/ })).closest(
      'div',
    )!
    expect(within(row).getByText('Deleted')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Delete project Physics' }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Restore project Physics' }),
    )
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Restore this project?' }),
      ).getByRole('button', { name: 'Restore project' }),
    )

    expect(await screen.findByText('Project restored.')).toBeVisible()
    expect(requested(mocks.fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/projects\/p1\/restore$/),
    )
  })

  it('restores a deleted lecture from the Other lectures table', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/users/u1/projects': () => ({
        status: 200,
        body: { projects },
      }),
      '/api/admin/users/u1/decks': () => ({
        status: 200,
        body: {
          decks: [
            decks[0],
            { ...decks[1]!, deletedAt: '2026-07-20T09:00:00Z' },
          ],
        },
      }),
      '/api/admin/decks/d2/restore': () => ({ status: 204 }),
      '/api/admin/users/u1': () => ({ status: 200, body: detail }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/users/u1']}>
        <Routes>
          <Route
            path="/app/admin/users/:userId"
            element={<AdminUserDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByText('Other lectures'))

    const row = screen
      .getByRole('link', { name: 'Untitled lecture' })
      .closest('tr')!
    expect(within(row).getByText('Deleted')).toBeVisible()
    expect(
      within(row).queryByRole('button', { name: /^Delete lecture/ }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Restore lecture Untitled lecture',
      }),
    )
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Restore this lecture?' }),
      ).getByRole('button', { name: 'Restore lecture' }),
    )

    expect(await screen.findByText('Lecture restored.')).toBeVisible()
    expect(requested(mocks.fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/decks\/d2\/restore$/),
    )
  })
})
