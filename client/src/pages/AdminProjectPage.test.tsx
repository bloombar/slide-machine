/**
 * Unit tests for the per-project admin view: project header with owner
 * and visibility, the detail rows, the lecture table with viewer links,
 * the "View project" bypass (confirmed and logged for private projects),
 * and the delete actions (lecture, whole project). Settings are not
 * edited here — that moved into the project's own settings modal
 * (ADMIN-5), covered by ProjectPage's tests. Soft-deleted content is
 * covered too: the badge and the recovery action (ADMIN-6).
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
    effectiveGenerationFreedom: 2,
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
    // Serves GET (detail) and DELETE (delete project)
    '/api/admin/projects/p1': init => {
      if (init?.method === 'DELETE') return { status: 204 }
      return { status, body: detailBody }
    },
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

    expect(
      await screen.findByText(
        'Lecture deleted; you can restore it from this page.',
      ),
    ).toBeVisible()
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

// ADMIN-6: a soft-deleted project is still openable here, badged, with
// recovery in place of the danger zone.
describe('AdminProjectPage soft-deleted content', () => {
  const deletedDetail = { ...detail, deletedAt: '2026-07-20T09:00:00Z' }

  it('badges the project, withdraws the product view, and offers a restore', async () => {
    renderPage(200, deletedDetail)
    await screen.findByRole('heading', { name: 'Physics' })

    expect(screen.getByText('Deleted')).toBeVisible()
    expect(screen.getByText(/This project is deleted/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Restore project' }),
    ).toBeEnabled()
    // Nothing to open in the product, and nothing to delete again
    expect(
      screen.queryByRole('button', { name: 'View project' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete project' }),
    ).not.toBeInTheDocument()
  })

  it('restores the project after a confirm and reports it', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/projects/p1/restore': () => ({ status: 204 }),
      '/api/admin/projects/p1': () => ({ status: 200, body: deletedDetail }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/projects/p1']}>
        <Routes>
          <Route
            path="/app/admin/projects/:projectId"
            element={<AdminProjectPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Physics' })

    fireEvent.click(screen.getByRole('button', { name: 'Restore project' }))
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

  it('notes an owner who was deleted along with the project', async () => {
    renderPage(200, {
      ...deletedDetail,
      owner: { ...detail.owner, deletedAt: '2026-07-20T09:00:00Z' },
    })
    await screen.findByRole('heading', { name: 'Physics' })
    expect(screen.getByText(/account deleted/)).toBeVisible()
  })

  it('badges a deleted lecture in the table and restores it', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/decks/d1/restore': () => ({ status: 204 }),
      '/api/admin/projects/p1': () => ({
        status: 200,
        body: {
          ...detail,
          decks: [{ ...detail.decks[0]!, deletedAt: '2026-07-20T09:00:00Z' }],
        },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/projects/p1']}>
        <Routes>
          <Route
            path="/app/admin/projects/:projectId"
            element={<AdminProjectPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    const row = (await screen.findByRole('link', { name: 'Waves' })).closest(
      'tr',
    )!
    expect(within(row).getByText('Deleted')).toBeVisible()

    fireEvent.click(
      within(row).getByRole('button', { name: 'Restore lecture Waves' }),
    )
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Restore this lecture?' }),
      ).getByRole('button', { name: 'Restore lecture' }),
    )

    expect(await screen.findByText('Lecture restored.')).toBeVisible()
    expect(requested(mocks.fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/decks\/d1\/restore$/),
    )
  })
})
