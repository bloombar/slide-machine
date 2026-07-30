/**
 * Unit tests for the settings change log page: the table contents and its
 * before/after rendering, the entity-kind filter, the empty state,
 * pagination, the CSV download flow, and the error state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminSettingsLogsPage from './AdminSettingsLogsPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const logs = [
  {
    id: 's1',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    actorRole: 'admin',
    entityType: 'user',
    entityId: 'u9',
    entityName: 'ada@example.com',
    ownerId: 'u9',
    changes: { locale: { from: 'en', to: 'fr' } },
    createdAt: '2026-07-02T12:00:00Z',
  },
  {
    id: 's2',
    actorId: 'u9',
    actorEmail: 'ada@example.com',
    actorRole: 'owner',
    entityType: 'deck',
    entityId: 'd3',
    entityName: 'Igneous Rocks',
    ownerId: 'u9',
    changes: { language: { from: null, to: 'es' } },
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
    '/api/admin/settings-logs/export': exportHandler,
    '/api/admin/settings-logs?': listHandler,
  })
  render(
    <MemoryRouter>
      <AdminSettingsLogsPage />
    </MemoryRouter>,
  )
  return mocks
}

/** Renders the page showing one entry, so its cells can be read without
 * other rows' in the way. Overrides merge onto a minimal entry. */
const renderOne = async (over: Record<string, unknown>) => {
  const only = {
    id: 'o1',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    actorRole: 'owner',
    entityType: 'project',
    entityId: 'p7',
    ownerId: 'u9',
    changes: { title: { from: 'Rocks', to: 'Igneous Rocks' } },
    createdAt: '2026-07-02T12:00:00Z',
    ...over,
  }
  renderPage(() => ({
    status: 200,
    body: { logs: [only], total: 1, page: 1, limit: 25 },
  }))
  await screen.findByText('Page 1 of 1')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdminSettingsLogsPage', () => {
  it('lists who changed what, in which role, and how', async () => {
    renderPage()
    // The actor links to their admin detail page, with their role beside it
    const actor = await screen.findByRole('link', {
      name: 'admin@example.com',
    })
    expect(actor).toHaveAttribute('href', '/app/admin/users/a1')
    expect(screen.getByText('admin')).toBeVisible()
    expect(screen.getByText('owner')).toBeVisible()

    // Each entity links to its own admin page under its recorded name.
    // Ada appears twice — as the account whose settings an admin changed,
    // and as the actor of her own lecture edit — both linking to her page.
    const ada = screen.getAllByRole('link', { name: 'ada@example.com' })
    expect(ada).toHaveLength(2)
    for (const link of ada) {
      expect(link).toHaveAttribute('href', '/app/admin/users/u9')
    }
    expect(screen.getByRole('link', { name: 'Igneous Rocks' })).toHaveAttribute(
      'href',
      '/app/admin/decks/d3',
    )
    expect(screen.getByText('account')).toBeVisible()
    expect(screen.getByText('lecture')).toBeVisible()

    // The change itself reads field, old value, new value
    expect(screen.getByText('locale')).toBeVisible()
    expect(screen.getByText('en')).toBeVisible()
    expect(screen.getByText('fr')).toBeVisible()
    // Locale-independent: the formatted time includes the year
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('reads a cleared setting as "not set" rather than null', async () => {
    await renderOne({ changes: { language: { from: 'fr', to: null } } })
    expect(screen.getByText('fr')).toBeVisible()
    expect(screen.getByText('not set')).toBeVisible()
    expect(screen.queryByText('null')).toBeNull()
  })

  it('lists every changed field of one edit', async () => {
    await renderOne({
      changes: {
        language: { from: null, to: 'es' },
        generationFreedom: { from: 2, to: 5 },
      },
    })
    expect(screen.getByText('language')).toBeVisible()
    expect(screen.getByText('generationFreedom')).toBeVisible()
    expect(screen.getByText('5')).toBeVisible()
  })

  it('names an untitled project by its placeholder', async () => {
    await renderOne({ entityType: 'project', entityName: '  ' })
    expect(screen.getByRole('link', { name: 'Default project' })).toBeVisible()
  })

  it('filters by entity kind and refetches from page 1', async () => {
    const { calls } = renderPage()
    await screen.findByText('Page 1 of 1')
    expect(calls.at(-1)).not.toContain('entityType=')

    fireEvent.change(screen.getByRole('combobox', { name: 'Settings kind' }), {
      target: { value: 'project' },
    })
    await waitFor(() => expect(calls.at(-1)).toContain('entityType=project'))
    expect(calls.at(-1)).toContain('page=1')

    // Back to everything drops the filter again
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings kind' }), {
      target: { value: 'all' },
    })
    await waitFor(() => expect(calls.at(-1)).not.toContain('entityType='))
  })

  it('shows the empty state', async () => {
    renderPage(() => ({
      status: 200,
      body: { logs: [], total: 0, page: 1, limit: 25 },
    }))
    expect(await screen.findByText('No settings changes yet.')).toBeVisible()
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
    await screen.findByText('Page 1 of 1')
    expect(calls.at(-1)).toContain('limit=100')

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Log entries per page' }),
      { target: { value: '250' } },
    )
    await waitFor(() => expect(calls.at(-1)).toContain('limit=250'))
    expect(calls.at(-1)).toContain('page=1')
  })

  it('downloads the CSV export, keeping the current filter', async () => {
    const { calls } = renderPage()
    await screen.findByText('Page 1 of 1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings kind' }), {
      target: { value: 'deck' },
    })
    await waitFor(() => expect(calls.at(-1)).toContain('entityType=deck'))

    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(calls.at(-1)).toContain('/api/admin/settings-logs/export')
    expect(calls.at(-1)).toContain('entityType=deck')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('surfaces a download failure without breaking the page', async () => {
    renderPage(undefined, () => ({ status: 500 }))
    await screen.findByText('Page 1 of 1')

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('Download failed.')).toBeVisible()
    expect(screen.getByText('Igneous Rocks')).toBeVisible()
  })

  it('shows an error state when the request fails', async () => {
    renderPage(() => ({ status: 500 }))
    expect(
      await screen.findByText('Could not load the settings log.'),
    ).toBeVisible()
  })
})
