/**
 * Unit tests for the home screen: projects as sub-headings with their
 * lectures beneath, capped at the configured limit with an expander.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import HomePage from './HomePage'
import { mockFetchRoutes } from '../test/fetch-mock'

vi.mock('../config', () => ({
  config: {
    apiBaseUrl: '',
    homeLecturesLimit: 2,
    defaultProjectTitle: 'Default project',
  },
}))

/**
 * Relative to now, never a literal date. The row renders its age with
 * `Intl.RelativeTimeFormat({ numeric: 'auto' })`, which words the -1 case of
 * every unit as "yesterday" / "last week" / "last month" — with no "ago" in it
 * at all. A fixed timestamp therefore drifts from "3 weeks ago" into
 * "last month" as real time passes, breaking the assertion below on a date
 * rather than on a change. Three days keeps it inside the "N days ago" bucket
 * indefinitely; DeckViewerPage.test.tsx pins its fixture the same way.
 */
const UPDATED_AT = new Date(Date.now() - 3 * 86_400_000).toISOString()

const deck = (id: string, projectId: string, title: string) => ({
  id,
  projectId,
  ownerId: 'u1',
  title,
  templateId: 'classic',
  visibility: 'private',
  permalinkSlug: `${id}-slug`,
  slideOrder: ['a', 'b'],
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: UPDATED_AT,
})

beforeEach(() => {
  setAccessToken(null)
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
    '/api/actions/project.list': () => ({
      status: 200,
      body: [
        { id: 'p1', ownerId: 'u1', title: 'Biology', createdAt: '' },
        { id: 'p2', ownerId: 'u1', title: 'Chemistry', createdAt: '' },
      ],
    }),
    '/api/actions/deck.list': () => ({
      status: 200,
      body: [
        deck('d1', 'p1', 'Newest lecture'),
        deck('d2', 'p1', 'Middle lecture'),
        deck('d3', 'p1', 'Oldest lecture'),
      ],
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderHome = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <HomePage />
      </AuthProvider>
    </MemoryRouter>,
  )

describe('HomePage', () => {
  it('renders each project as a sub-heading with lectures beneath', async () => {
    renderHome()
    expect(
      await screen.findByRole('heading', { name: 'Biology' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Chemistry' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Newest lecture')).toBeInTheDocument()
  })

  it('shows slide count and modification age per lecture', async () => {
    renderHome()
    await screen.findByText('Newest lecture')
    const meta = screen.getAllByText(/2 slides · edited .+ ago/)
    expect(meta.length).toBeGreaterThan(0)
  })

  it('caps lectures at the limit and links Show all to the project', async () => {
    renderHome()
    await screen.findByText('Newest lecture')

    // Limit is mocked to 2: the third lecture stays behind the link
    expect(screen.getByText('Middle lecture')).toBeInTheDocument()
    expect(screen.queryByText('Oldest lecture')).not.toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /show all 3 lectures/i }),
    ).toHaveAttribute('href', '/app/projects/p1')
  })

  it('renders projects in the order the server returns them', async () => {
    // The server ranks projects by modification recency; the client must
    // preserve that order rather than re-sort by anything of its own.
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [
          { id: 'p1', ownerId: 'u1', title: 'Biology', createdAt: '' },
          { id: 'p2', ownerId: 'u1', title: 'Chemistry', createdAt: '' },
        ],
      }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map(h => h.textContent)
    expect(headings).toEqual(['Biology', 'Chemistry'])
  })

  it('starts a new untitled lecture from the New lecture zone', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [{ id: 'p1', ownerId: 'u1', title: 'Biology', createdAt: '' }],
      }),
      // Even with no lectures, the dashed New lecture zone is present
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.create': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { id: 'd9', title: '', permalinkSlug: 'untitled-fff000' },
        }
      },
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Start a new lecture in Biology' }),
    )

    await vi.waitFor(() => expect(sent).toEqual({ projectId: 'p1' }))
  })

  it('imports a lecture from a file into a project and lists it', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [{ id: 'p1', ownerId: 'u1', title: 'Biology', createdAt: '' }],
      }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.import': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            deck: {
              id: 'd9',
              projectId: 'p1',
              title: 'Imported Deck',
              permalinkSlug: 'imported-deck-xyz',
              slideOrder: [],
              updatedAt: new Date().toISOString(),
            },
            warnings: [],
          },
        }
      },
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    const file = new File(
      ['version: 1\nkind: deck\ntitle: Imported Deck\n'],
      'deck.yaml',
      {
        type: 'application/x-yaml',
      },
    )
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'p1',
        content: 'version: 1\nkind: deck\ntitle: Imported Deck\n',
      }),
    )
    expect(
      await screen.findByText('Imported "Imported Deck".'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Imported Deck/ }),
    ).toBeInTheDocument()
  })

  it('the empty state creates a default project, then a lecture in it', async () => {
    const calls: Record<string, unknown> = {}
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      // A brand-new user: no projects and no lectures at all
      '/api/actions/project.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.create': init => {
        calls.project = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { id: 'p9', ownerId: 'u1', title: '', createdAt: '' },
        }
      },
      '/api/actions/deck.create': init => {
        calls.deck = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { id: 'd9', title: '', permalinkSlug: 'untitled-fff000' },
        }
      },
    })
    renderHome()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a new lecture' }),
    )

    // A titleless default project is created first, then the lecture in it
    await vi.waitFor(() => expect(calls.project).toEqual({}))
    await vi.waitFor(() => expect(calls.deck).toEqual({ projectId: 'p9' }))
  })

  it('creates a project from the New project modal, with an optional description', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.create': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { id: 'p9', ownerId: 'u1', title: 'Physics', createdAt: '' },
        }
      },
    })
    renderHome()
    // With no projects, the empty-state New lecture zone is shown
    await screen.findByRole('button', { name: 'Start a new lecture' })

    // Modal is closed until the header button opens it
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Physics' },
    })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Mechanics and beyond' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await vi.waitFor(() =>
      expect(sent).toEqual({
        title: 'Physics',
        description: 'Mechanics and beyond',
      }),
    )
  })

  it('cancelling the New project modal closes it without creating', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the project kebab offers Settings, Share, and Delete', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    fireEvent.click(screen.getByRole('button', { name: 'Options for Biology' }))
    const menu = screen.getByRole('menu', { name: 'Options for Biology' })
    expect(
      within(menu).getByRole('menuitem', { name: 'Settings' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Share' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Delete' }),
    ).toBeInTheDocument()
  })

  it('deletes a project from the kebab after confirming', async () => {
    let deleted: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [
          { id: 'p1', ownerId: 'u1', title: 'Biology', createdAt: '' },
          { id: 'p2', ownerId: 'u1', title: 'Chemistry', createdAt: '' },
        ],
      }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.delete': init => {
        deleted = JSON.parse(String(init?.body))
        return { status: 200, body: { ok: true } }
      },
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Biology' })

    fireEvent.click(screen.getByRole('button', { name: 'Options for Biology' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete project?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(deleted).toEqual({ projectId: 'p1' }))
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Biology' }),
      ).not.toBeInTheDocument(),
    )
    // The other project is untouched
    expect(
      screen.getByRole('heading', { name: 'Chemistry' }),
    ).toBeInTheDocument()
  })
})
