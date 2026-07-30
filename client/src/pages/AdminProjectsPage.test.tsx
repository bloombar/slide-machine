/**
 * Unit tests for the admin project directory: table contents and links,
 * pagination, sorting, page size, the error state, and the badge on
 * soft-deleted rows (ADMIN-6).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminProjectsPage from './AdminProjectsPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const projects = [
  {
    id: 'p1',
    ownerId: 'u1',
    ownerEmail: 'ada@example.com',
    title: 'Physics',
    visibility: 'public',
    deckCount: 2,
    createdAt: '2026-07-01T12:00:00Z',
    updatedAt: '2026-07-02T12:00:00Z',
  },
  {
    id: 'p2',
    ownerId: 'u2',
    ownerEmail: '',
    title: '',
    visibility: 'restricted',
    deckCount: 0,
    createdAt: '2026-06-15T09:30:00Z',
    updatedAt: '2026-06-15T09:30:00Z',
  },
]

const renderPage = (
  handler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { projects, total: 2, page: 1, limit: 25 },
  }),
) => {
  const mocks = mockFetchRoutes({ '/api/admin/projects': handler })
  render(
    <MemoryRouter>
      <AdminProjectsPage />
    </MemoryRouter>,
  )
  return mocks
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminProjectsPage', () => {
  it('lists title, owner, visibility, and lecture count with links', async () => {
    renderPage()
    const title = await screen.findByRole('link', { name: 'Physics' })
    expect(title).toHaveAttribute('href', '/app/admin/projects/p1')

    const owner = screen.getByRole('link', { name: 'ada@example.com' })
    expect(owner).toHaveAttribute('href', '/app/admin/users/u1')

    expect(screen.getByText('Public')).toBeVisible()
    expect(screen.getByText('Private')).toBeVisible()
    expect(screen.getByText('2')).toBeVisible()
  })

  it('falls back for blank titles and missing owners', async () => {
    renderPage()
    const untitled = await screen.findByRole('link', {
      name: 'Untitled project',
    })
    expect(untitled).toHaveAttribute('href', '/app/admin/projects/p2')
    // The ownerless row shows a dash, not a link.
    expect(screen.getByText('—')).toBeVisible()
  })

  it('pages forward through a large directory', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { projects, total: 60, page: 1, limit: 25 },
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
      body: { projects, total: 60, page: 2, limit: 25 },
    }))
    await screen.findByRole('link', { name: 'Physics' })
    expect(calls.at(-1)).toContain('sort=updated:desc')

    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    await screen.findByRole('link', { name: 'Physics' })
    expect(calls.at(-1)).toContain('sort=title:asc')
    expect(calls.at(-1)).toContain('page=1')

    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    await screen.findByRole('link', { name: 'Physics' })
    expect(calls.at(-1)).toContain('sort=title:desc')
  })

  it('sorts by every column, including the joined and computed ones', async () => {
    const { calls } = renderPage()
    await screen.findByRole('link', { name: 'Physics' })

    const columns: Array<[string, string]> = [
      ['Title', 'title'],
      ['Owner', 'owner'],
      ['Visibility', 'visibility'],
      ['Lectures', 'lectures'],
      ['Created', 'created'],
      ['Updated', 'updated'],
    ]
    for (const [label, field] of columns) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await screen.findByRole('link', { name: 'Physics' })
      expect(calls.at(-1)).toContain(`sort=${field}:asc`)
    }
  })

  it('marks only the sorted column for assistive tech', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Physics' })
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    await screen.findByRole('link', { name: 'Physics' })

    const sorted = screen
      .getAllByRole('columnheader')
      .filter(th => th.getAttribute('aria-sort') !== 'none')
    expect(sorted).toHaveLength(1)
    expect(sorted[0]).toHaveTextContent('Owner')
    expect(sorted[0]).toHaveAttribute('aria-sort', 'ascending')
  })

  it('defaults to a page size of 100 and changing it refetches from page 1', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { projects, total: 60, page: 1, limit: 100 },
    }))
    await screen.findByRole('link', { name: 'Physics' })
    expect(calls.at(-1)).toContain('limit=100')

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Projects per page' }),
      { target: { value: '250' } },
    )
    await screen.findByRole('link', { name: 'Physics' })
    expect(calls.at(-1)).toContain('limit=250')
    expect(calls.at(-1)).toContain('page=1')
  })

  it('shows the empty state on a blank page', async () => {
    renderPage(() => ({
      status: 200,
      body: { projects: [], total: 0, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('No projects on this page.')).toBeVisible()
  })

  it('shows an error state when the request fails', async () => {
    renderPage(() => ({ status: 500 }))
    expect(await screen.findByText('Could not load projects.')).toBeVisible()
  })

  it('badges a soft-deleted row and leaves live rows unmarked (ADMIN-6)', async () => {
    renderPage(() => ({
      status: 200,
      body: {
        projects: [
          projects[0],
          {
            ...projects[1]!,
            title: 'Removed',
            deletedAt: '2026-07-20T09:00:00Z',
          },
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
    // Still a working link into the project's admin page
    expect(
      within(deletedRow).getByRole('link', { name: 'Removed' }),
    ).toHaveAttribute('href', '/app/admin/projects/p2')

    const liveRow = screen.getByRole('link', { name: 'Physics' }).closest('tr')!
    expect(within(liveRow).queryByText('Deleted')).not.toBeInTheDocument()
  })
})
