/**
 * Unit tests for the admin audit log page: table contents, empty state,
 * pagination, the CSV download flow, and the error state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminLogsPage from './AdminLogsPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const logs = [
  {
    id: 'l1',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    action: 'user.ban',
    targetType: 'user',
    targetId: 'u9',
    details: { reason: 'spam' },
    createdAt: '2026-07-02T12:00:00Z',
  },
  {
    id: 'l2',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    action: 'deck.delete',
    createdAt: '2026-07-01T09:30:00Z',
  },
]

const renderPage = (
  listHandler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { logs, total: 2, page: 1, limit: 25 },
  }),
  exportHandler: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: 'createdAt,actorEmail\r\n',
  }),
) => {
  const mocks = mockFetchRoutes({
    '/api/admin/logs/export': exportHandler,
    '/api/admin/logs?': listHandler,
  })
  render(
    <MemoryRouter>
      <AdminLogsPage />
    </MemoryRouter>,
  )
  return mocks
}

/** Renders the page showing one entry, so the Target column can be read
 * without other rows' cells in the way. Overrides are merged onto a
 * minimal entry; the action defaults to one that leaves its target
 * standing. */
const renderTarget = async (over: Record<string, unknown>) => {
  const only = {
    id: 't1',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    action: 'user.ban_email',
    createdAt: '2026-07-02T12:00:00Z',
    ...over,
  }
  renderPage(() => ({
    status: 200,
    body: { logs: [only], total: 1, page: 1, limit: 25 },
  }))
  await screen.findByText(only.action)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdminLogsPage', () => {
  it('lists time, admin, action, target, and details', async () => {
    renderPage()
    expect(await screen.findByText('user.ban')).toBeVisible()
    expect(screen.getByText('deck.delete')).toBeVisible()
    // The acting admin links to their admin detail page
    const links = screen.getAllByRole('link', { name: 'admin@example.com' })
    expect(links[0]).toHaveAttribute('href', '/app/admin/users/a1')
    // With no name recorded, the target links under its kind; the id
    // stays out of the table and lives in the href
    expect(screen.getByRole('link', { name: 'user' })).toHaveAttribute(
      'href',
      '/app/admin/users/u9',
    )
    expect(screen.queryByText(/u9/)).not.toBeInTheDocument()
    // An entry with no target still gets a placeholder cell
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('{"reason":"spam"}')).toBeVisible()
    // Locale-independent: the formatted time includes the year
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('links a user target to its admin page under the recorded email', async () => {
    await renderTarget({
      targetType: 'user',
      targetId: 'u9',
      details: { email: 'victim@example.com' },
    })
    expect(
      screen.getByRole('link', { name: 'victim@example.com' }),
    ).toHaveAttribute('href', '/app/admin/users/u9')
    // The kind still labels the cell
    expect(screen.getByText('user')).toBeVisible()
  })

  it('links project and lecture targets under their recorded titles', async () => {
    await renderTarget({
      action: 'project.private_view',
      targetType: 'project',
      targetId: 'p7',
      details: { title: 'Intro to Rocks' },
    })
    expect(
      screen.getByRole('link', { name: 'Intro to Rocks' }),
    ).toHaveAttribute('href', '/app/admin/projects/p7')

    await renderTarget({
      action: 'deck.private_view',
      targetType: 'deck',
      targetId: 'd3',
      details: { title: 'Igneous Rocks' },
    })
    expect(screen.getByRole('link', { name: 'Igneous Rocks' })).toHaveAttribute(
      'href',
      '/app/admin/decks/d3',
    )
  })

  it('names untitled projects and lectures by their placeholders', async () => {
    await renderTarget({
      action: 'project.private_view',
      targetType: 'project',
      targetId: 'p7',
      details: { title: '  ' },
    })
    expect(screen.getByRole('link', { name: 'Default project' })).toBeVisible()

    await renderTarget({
      action: 'deck.private_view',
      targetType: 'deck',
      targetId: 'd3',
      details: {},
    })
    expect(screen.getByRole('link', { name: 'Untitled lecture' })).toBeVisible()
  })

  it('leaves a deleted target unlinked — its page is gone', async () => {
    await renderTarget({
      action: 'deck.delete',
      targetType: 'deck',
      targetId: 'd3',
      details: { title: 'Igneous Rocks' },
    })
    expect(screen.getByText('Igneous Rocks')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Igneous Rocks' })).toBeNull()
  })

  it('leaves an unknown target kind unlinked', async () => {
    await renderTarget({
      action: 'slide.private_view',
      targetType: 'slide',
      targetId: 's1',
      details: { title: 'Slide 4' },
    })
    expect(screen.getByText('Slide 4')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Slide 4' })).toBeNull()
  })

  it('shows the empty state', async () => {
    renderPage(() => ({
      status: 200,
      body: { logs: [], total: 0, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('No log entries yet.')).toBeVisible()
  })

  it('pages forward through a large log', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { logs, total: 60, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('Page 1 of 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Page/)
    expect(calls.at(-1)).toContain('page=2')
  })

  it('changing the page size refetches from page 1', async () => {
    const { calls } = renderPage(() => ({
      status: 200,
      body: { logs, total: 60, page: 1, limit: 100 },
    }))
    await screen.findByText('user.ban')
    expect(calls.at(-1)).toContain('limit=100')

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Log entries per page' }),
      { target: { value: '250' } },
    )
    await screen.findByText('user.ban')
    expect(calls.at(-1)).toContain('limit=250')
    expect(calls.at(-1)).toContain('page=1')
  })

  it('downloads the CSV export through a temporary object URL', async () => {
    const { calls } = renderPage()
    await screen.findByText('user.ban')

    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(calls.at(-1)).toContain('/api/admin/logs/export')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('surfaces a download failure without breaking the page', async () => {
    renderPage(undefined, () => ({ status: 500 }))
    await screen.findByText('user.ban')

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('Download failed.')).toBeVisible()
    expect(screen.getByText('user.ban')).toBeVisible()
  })

  it('shows an error state when the request fails', async () => {
    renderPage(() => ({ status: 500 }))
    expect(
      await screen.findByText('Could not load the audit log.'),
    ).toBeVisible()
  })
})
