/**
 * Unit tests for the admin lecture directory: table contents and links,
 * pagination, sorting, page size, the error state, and the badge on
 * soft-deleted rows (ADMIN-6).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminDecksPage from './AdminDecksPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const decks = [
  {
    id: 'd1',
    projectId: 'p1',
    projectTitle: 'Physics',
    ownerId: 'u1',
    ownerEmail: 'ada@example.com',
    title: 'Waves',
    permalinkSlug: 'waves-abc123',
    visibility: 'public',
    slideCount: 4,
    createdAt: '2026-07-01T12:00:00Z',
    updatedAt: '2026-07-02T12:00:00Z',
  },
  {
    id: 'd2',
    projectId: 'p2',
    projectTitle: '',
    ownerId: 'u2',
    ownerEmail: '',
    title: '',
    permalinkSlug: 'untitled-abc123',
    visibility: 'restricted',
    slideCount: 0,
    createdAt: '2026-06-15T09:30:00Z',
    updatedAt: '2026-06-15T09:30:00Z',
  },
]

const renderPage = (
  handler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { decks, total: 2, page: 1, limit: 25 },
  }),
) => {
  const mocks = mockFetchRoutes({ '/api/admin/decks': handler })
  render(
    <MemoryRouter>
      <AdminDecksPage />
    </MemoryRouter>,
  )
  return mocks
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminDecksPage', () => {
  it('lists lecture, project, owner, visibility, and slide count with links', async () => {
    renderPage()
    const lecture = await screen.findByRole('link', { name: 'Waves' })
    expect(lecture).toHaveAttribute('href', '/app/admin/decks/d1')

    const project = screen.getByRole('link', { name: 'Physics' })
    expect(project).toHaveAttribute('href', '/app/admin/projects/p1')

    const owner = screen.getByRole('link', { name: 'ada@example.com' })
    expect(owner).toHaveAttribute('href', '/app/admin/users/u1')

    expect(screen.getByText('Public')).toBeVisible()
    expect(screen.getByText('Private')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
  })

  it('falls back for blank titles and missing owners', async () => {
    renderPage()
    const untitled = await screen.findByRole('link', {
      name: 'Untitled lecture',
    })
    expect(untitled).toHaveAttribute('href', '/app/admin/decks/d2')
    const project = screen.getByRole('link', { name: 'Untitled project' })
    expect(project).toHaveAttribute('href', '/app/admin/projects/p2')
    // The ownerless row shows a dash, not a link.
    expect(screen.getByText('—')).toBeVisible()
  })

  it('pages forward through a large directory', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { decks, total: 60, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('Page 1 of 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Page/)
    expect(calls.at(-1)).toContain('page=2')
  })

  it('changing the sort refetches from page 1 and flips on re-click', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { decks, total: 60, page: 2, limit: 25 },
    }))
    await screen.findByRole('link', { name: 'Waves' })
    expect(calls.at(-1)).toContain('sort=updated:desc')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    await screen.findByRole('link', { name: 'Waves' })
    expect(calls.at(-1)).toContain('sort=title:asc')
    expect(calls.at(-1)).toContain('page=1')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    await screen.findByRole('link', { name: 'Waves' })
    expect(calls.at(-1)).toContain('sort=title:desc')
  })

  it('sorts by every column, including the joined and computed ones', async () => {
    const { calls } = renderPage()
    await screen.findByRole('link', { name: 'Waves' })

    const columns: Array<[string, string]> = [
      ['Lecture', 'title'],
      ['Project', 'project'],
      ['Owner', 'owner'],
      ['Visibility', 'visibility'],
      ['Slides', 'slides'],
      ['Created', 'created'],
      ['Updated', 'updated'],
    ]
    for (const [label, field] of columns) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await screen.findByRole('link', { name: 'Waves' })
      expect(calls.at(-1)).toContain(`sort=${field}:asc`)
    }
  })

  it('marks only the sorted column for assistive tech', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Waves' })
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }))
    await screen.findByRole('link', { name: 'Waves' })

    const sorted = screen
      .getAllByRole('columnheader')
      .filter(th => th.getAttribute('aria-sort') !== 'none')
    expect(sorted).toHaveLength(1)
    expect(sorted[0]).toHaveTextContent('Slides')
    expect(sorted[0]).toHaveAttribute('aria-sort', 'ascending')
  })

  it('defaults to a page size of 100 and changing it refetches from page 1', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { decks, total: 60, page: 1, limit: 100 },
    }))
    await screen.findByRole('link', { name: 'Waves' })
    expect(calls.at(-1)).toContain('limit=100')

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Lectures per page' }),
      { target: { value: '250' } },
    )
    await screen.findByRole('link', { name: 'Waves' })
    expect(calls.at(-1)).toContain('limit=250')
    expect(calls.at(-1)).toContain('page=1')
  })

  it('shows the empty state on a blank page', async () => {
    renderPage(() => ({
      status: 200,
      body: { decks: [], total: 0, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('No lectures on this page.')).toBeVisible()
  })

  it('shows an error state when the request fails', async () => {
    renderPage(() => ({ status: 500 }))
    expect(await screen.findByText('Could not load lectures.')).toBeVisible()
  })

  it('badges a soft-deleted row and leaves live rows unmarked (ADMIN-6)', async () => {
    renderPage(() => ({
      status: 200,
      body: {
        decks: [
          decks[0],
          { ...decks[1]!, title: 'Removed', deletedAt: '2026-07-20T09:00:00Z' },
        ],
        total: 2,
        page: 1,
        limit: 25,
      },
    }))
    const deletedRow = (
      await screen.findByRole('link', { name: 'Removed' })
    ).closest('tr')!
    expect(within(deletedRow).getByText('Deleted')).toBeVisible()

    const liveRow = screen.getByRole('link', { name: 'Waves' }).closest('tr')!
    expect(within(liveRow).queryByText('Deleted')).not.toBeInTheDocument()
  })
})
