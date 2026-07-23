/**
 * Unit tests for the per-lecture admin view: lecture header with
 * visibility, project and owner links, the "View slideshow" link to the
 * live viewer, the detail rows, and the delete action.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AdminDeckPage from './AdminDeckPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const detail = {
  deck: {
    id: 'd1',
    projectId: 'p1',
    title: 'Waves',
    permalinkSlug: 'waves-abc123',
    visibility: 'restricted',
    slideCount: 5,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-03T00:00:00Z',
  },
  project: { id: 'p1', title: 'Physics' },
  owner: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
}

const renderPage = (status = 200, detailBody: unknown = detail) => {
  // Serves both GET (detail) and DELETE (delete lecture)
  const mocks = mockFetchRoutes({
    '/api/admin/decks/d1': init =>
      init?.method === 'DELETE'
        ? { status: 204 }
        : { status, body: detailBody },
  })
  render(
    <MemoryRouter initialEntries={['/app/admin/decks/d1']}>
      <Routes>
        <Route path="/app/admin/decks/:deckId" element={<AdminDeckPage />} />
        <Route
          path="/app/admin/projects/:projectId"
          element={<p>project page</p>}
        />
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

describe('AdminDeckPage', () => {
  it('shows the lecture title, its visibility, project, and owner', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Waves' })).toBeVisible()
    expect(screen.getByText('Private')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Physics' })).toHaveAttribute(
      'href',
      '/app/admin/projects/p1',
    )
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/app/admin/users/u1',
    )
    expect(screen.getByText(/ada@example\.com/)).toBeVisible()
  })

  it('links to the live slideshow', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    expect(
      screen.getByRole('link', { name: 'View slideshow' }),
    ).toHaveAttribute('href', '/d/waves-abc123')
  })

  it("links back to the project's admin page", async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByRole('link', { name: '← Physics' })).toHaveAttribute(
      'href',
      '/app/admin/projects/p1',
    )
  })

  it('shows the detail rows', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByText('5')).toBeVisible()
    expect(screen.getByText('/d/waves-abc123')).toBeVisible()
  })

  it('falls back to "Untitled lecture" for a blank title', async () => {
    renderPage(200, { ...detail, deck: { ...detail.deck, title: '  ' } })
    expect(
      await screen.findByRole('heading', { name: 'Untitled lecture' }),
    ).toBeVisible()
  })

  it("deletes the lecture after a confirm and returns to the project's page", async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete lecture' }),
    )

    expect(await screen.findByText('project page')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/decks\/d1$/),
    )
  })

  it('does nothing when the confirm dialog is cancelled', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(
      requested(fetchMock).filter(r => r.startsWith('DELETE')),
    ).toHaveLength(0)
  })

  it('shows an error state with a directory back link when the load fails', async () => {
    renderPage(500)
    expect(
      await screen.findByText('Could not load this lecture.'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '← All users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })
})
