/**
 * Unit tests for the home screen: projects as sub-headings with their
 * lectures beneath, capped at the configured limit with an expander.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import HomePage from './HomePage'
import { mockFetchRoutes } from '../test/fetch-mock'

vi.mock('../config', () => ({
  config: { apiBaseUrl: '', homeLecturesLimit: 2 },
}))

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
  updatedAt: '2026-07-02T00:00:00.000Z',
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

  it('starts a new untitled lecture from the + beside a project', async () => {
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

    await vi.waitFor(() =>
      expect(sent).toEqual({ projectId: 'p1', templateId: 'classic' }),
    )
  })

  it('starts a lecture straight from an empty project', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [{ id: 'p2', ownerId: 'u1', title: 'Chemistry', createdAt: '' }],
      }),
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
    await screen.findByRole('heading', { name: 'Chemistry' })
    expect(screen.getByText(/no lectures yet/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'start one' }))
    await vi.waitFor(() =>
      expect(sent).toEqual({ projectId: 'p2', templateId: 'classic' }),
    )
  })
})
