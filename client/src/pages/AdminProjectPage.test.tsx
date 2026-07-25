/**
 * Unit tests for the per-project admin view: project header with owner
 * and visibility, the detail rows, the lecture table with viewer links,
 * the "View project" bypass (confirmed and logged for private projects),
 * and the delete actions (lecture, whole project).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AdminProjectPage from './AdminProjectPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const detail = {
  project: {
    id: 'p1',
    ownerId: 'u1',
    title: 'Physics',
    visibility: 'public',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
  },
  owner: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
  decks: [
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
  ],
}

const renderPage = (status = 200, detailBody: unknown = detail) => {
  // Keys ordered most-specific first: the fetch mock matches by substring
  const mocks = mockFetchRoutes({
    '/api/admin/decks/d1': () => ({ status: 204 }),
    // More specific than /projects/p1, so it must be matched first
    '/api/admin/projects/p1/private-view': () => ({ status: 204 }),
    // Serves both GET (detail) and DELETE (delete project)
    '/api/admin/projects/p1': init =>
      init?.method === 'DELETE'
        ? { status: 204 }
        : { status, body: detailBody },
  })
  render(
    <MemoryRouter initialEntries={['/app/admin/projects/p1']}>
      <Routes>
        <Route
          path="/app/admin/projects/:projectId"
          element={<AdminProjectPage />}
        />
        <Route path="/app/admin/users/:userId" element={<p>user page</p>} />
        <Route path="/app/projects/:projectId" element={<p>project page</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return mocks
}

/** Detail for a private (restricted) project. */
const privateDetail = {
  ...detail,
  project: { ...detail.project, visibility: 'restricted' },
}

/** The method+url pairs fetched so far. */
const requested = (
  fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock'],
) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminProjectPage', () => {
  it('shows the project title, its visibility, and its owner', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'Physics' }),
    ).toBeVisible()
    // Badge appears in the header and again per lecture row
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0)
    expect(screen.getByText(/ada@example\.com/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/app/admin/users/u1',
    )
  })

  it('shows the details, including the project id', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Physics' })
    const details = screen
      .getByRole('heading', { name: 'Details' })
      .closest('section')!
    expect(within(details).getByText('ID')).toBeVisible()
    expect(within(details).getByText('p1')).toBeVisible()
    // Locale-independent: the formatted dates include the year
    expect(within(details).getAllByText(/2026/).length).toBe(2)
    expect(within(details).getByText('Lectures')).toBeVisible()
  })

  it("links back to the owner's admin page", async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Physics' })
    expect(screen.getByRole('link', { name: '← Ada' })).toHaveAttribute(
      'href',
      '/app/admin/users/u1',
    )
  })

  it('lists lectures linked to their admin pages with badge and count', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Waves' })
    expect(link).toHaveAttribute('href', '/app/admin/decks/d1')
    const row = link.closest('tr')!
    expect(within(row).getByText('Public')).toBeVisible()
    expect(within(row).getByText('5')).toBeVisible()
  })

  it('deletes a lecture from its table row after a confirm', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('link', { name: 'Waves' })

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

  it("deletes the project after a confirm and returns to the owner's page", async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this project?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete project' }),
    )

    expect(await screen.findByText('user page')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/projects\/p1$/),
    )
  })

  it('does nothing when the confirm dialog is cancelled', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(
      requested(fetchMock).filter(r => r.startsWith('DELETE')),
    ).toHaveLength(0)
  })

  it('opens a public project straight away, with no confirm or view log', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'View project' }))

    // Public: navigates directly, no dialog and no private-view log
    expect(await screen.findByText('project page')).toBeVisible()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(requested(fetchMock)).not.toContainEqual(
      expect.stringMatching(/private-view/),
    )
  })

  it('confirms and logs before opening a private project', async () => {
    const { fetchMock } = renderPage(200, privateDetail)
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'View project' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'View this private project?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'View project' }),
    )

    // The access is logged, then the project page opens
    expect(await screen.findByText('project page')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/projects\/p1\/private-view$/),
    )
  })

  it('does not log or navigate when the private-view confirm is cancelled', async () => {
    const { fetchMock } = renderPage(200, privateDetail)
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'View project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('project page')).not.toBeInTheDocument()
    expect(requested(fetchMock)).not.toContainEqual(
      expect.stringMatching(/private-view/),
    )
  })

  it('shows an error state with a directory back link when the load fails', async () => {
    renderPage(500)
    expect(
      await screen.findByText('Could not load this project.'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '← All users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })

  it('shows the empty state when the project has no lectures', async () => {
    renderPage(200, { ...detail, decks: [] })
    await screen.findByRole('heading', { name: 'Physics' })
    expect(screen.getByText('No lectures.')).toBeVisible()
  })
})
