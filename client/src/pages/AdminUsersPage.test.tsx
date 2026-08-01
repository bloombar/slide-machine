/**
 * Unit tests for the admin user directory: table contents, pagination,
 * sorting, the error state, and the badge on soft-deleted accounts
 * (ADMIN-6).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminUsersPage from './AdminUsersPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const users = [
  {
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    emailVerified: true,
    planTier: 'free',
    createdAt: '2026-07-01T12:00:00Z',
  },
  {
    id: 'u2',
    email: 'grace@example.com',
    displayName: 'Grace',
    emailVerified: false,
    planTier: 'free',
    createdAt: '2026-06-15T09:30:00Z',
  },
]

const renderPage = (
  handler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { users, total: 2, page: 1, limit: 25 },
  }),
) => {
  const mocks = mockFetchRoutes({ '/api/admin/users': handler })
  render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>,
  )
  return mocks
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminUsersPage', () => {
  it('lists email, handle, and join time; emails link to the detail page', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'ada@example.com' })
    expect(link).toHaveAttribute('href', '/app/admin/users/u1')
    expect(screen.getByText('Grace')).toBeVisible()
    // Locale-independent: the formatted join time includes the year
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('pages forward through a large directory', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { users, total: 60, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('Page 1 of 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Page/)
    expect(calls.at(-1)).toContain('page=2')
  })

  it('changing the sort refetches from page 1', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { users, total: 60, page: 2, limit: 25 },
    }))
    await screen.findByRole('link', { name: 'ada@example.com' })

    // The arrow glyph is aria-hidden, so the header button's accessible
    // name is exactly the column label.
    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    await screen.findByRole('link', { name: 'ada@example.com' })
    expect(calls.at(-1)).toContain('sort=email:asc')
    expect(calls.at(-1)).toContain('page=1')

    // A second click on the active column flips the direction.
    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    await screen.findByRole('link', { name: 'ada@example.com' })
    expect(calls.at(-1)).toContain('sort=email:desc')
  })

  it('defaults to a page size of 100 and changing it refetches from page 1', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { users, total: 60, page: 1, limit: 100 },
    }))
    await screen.findByRole('link', { name: 'ada@example.com' })
    expect(calls.at(-1)).toContain('limit=100')

    fireEvent.change(screen.getByRole('combobox', { name: 'Users per page' }), {
      target: { value: '250' },
    })
    await screen.findByRole('link', { name: 'ada@example.com' })
    expect(calls.at(-1)).toContain('limit=250')
    expect(calls.at(-1)).toContain('page=1')
  })

  it('shows an error state when the request fails', async () => {
    renderPage(() => ({ status: 500 }))
    expect(await screen.findByText('Could not load users.')).toBeVisible()
  })

  it('badges a soft-deleted account and leaves live ones unmarked (ADMIN-6)', async () => {
    renderPage(() => ({
      status: 200,
      body: {
        users: [users[0], { ...users[1]!, deletedAt: '2026-07-20T09:00:00Z' }],
        total: 2,
        page: 1,
        limit: 25,
      },
    }))
    const deletedRow = (
      await screen.findByRole('link', { name: 'grace@example.com' })
    ).closest('tr')!
    expect(within(deletedRow).getByText('Deleted')).toBeVisible()

    const liveRow = screen
      .getByRole('link', { name: 'ada@example.com' })
      .closest('tr')!
    expect(within(liveRow).queryByText('Deleted')).not.toBeInTheDocument()
  })
})
