/**
 * Unit tests for the per-user admin view: account details, projects
 * expanding to lectures with viewer links, the "Other lectures" group
 * for decks living outside the user's own projects, and the moderation
 * actions (delete user/project/lecture, ban email, reset password).
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
    '/api/admin/decks/d1': () => ({ status: 204 }),
    // Serves both GET (detail) and DELETE (delete user)
    '/api/admin/users/u1': init =>
      init?.method === 'DELETE'
        ? { status: 204 }
        : { status, body: detailBody },
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
  it('shows account details and a public-profile link', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
    expect(screen.getByText('ada@example.com')).toBeVisible()
    expect(screen.getByText('pro')).toBeVisible()
    expect(screen.getByText('Lecturer')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'View public profile' }),
    ).toHaveAttribute('href', '/u/u1')
  })

  it('expands a project to its lectures, linked to the deck viewer', async () => {
    renderPage()
    const summary = await screen.findByText('Physics')
    fireEvent.click(summary)
    expect(screen.getByRole('link', { name: 'Waves' })).toHaveAttribute(
      'href',
      '/d/waves-abc123',
    )
  })

  it("shows each lecture's visibility badge and slide count", async () => {
    renderPage()
    const physics = await screen.findByText('Physics')
    fireEvent.click(physics)
    const wavesRow = screen.getByRole('link', { name: 'Waves' }).closest('tr')!
    expect(within(wavesRow).getByText('Public')).toBeVisible()
    expect(within(wavesRow).getByText('5')).toBeVisible()

    const other = screen.getByText('Other lectures')
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
    const updated = new Date('2026-07-03T00:00:00Z').toLocaleDateString()
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
    ).toHaveAttribute('href', '/d/untitled-xyz789')
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

  it('shows the Banned badge and disables the ban button for a banned user', async () => {
    renderPage(200, { ...detail, banned: true })
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.getByText('Banned')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Email banned' })).toBeDisabled()
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

    expect(await screen.findByText('Project deleted.')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/projects\/p1$/),
    )
  })

  it('deletes a lecture from its table row after a confirm', async () => {
    const { fetchMock } = renderPage()
    const physics = await screen.findByText('Physics')
    fireEvent.click(physics)

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete lecture Waves' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete lecture' }),
    )

    expect(await screen.findByText('Lecture deleted.')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/decks\/d1$/),
    )
  })
})
