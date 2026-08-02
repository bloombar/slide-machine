/**
 * Unit tests for the profile page: visible lectures grouped by project, the
 * indistinguishable not-found/private state, and who gets the Settings link.
 *
 * The page is read-only. Editing a name or bio now happens on the settings
 * page, which is also where the rest of the account's settings are, so the
 * tests that used to cover the in-place form live there instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import ProfilePage from './ProfilePage'
import { mockFetchRoutes } from '../test/fetch-mock'

const profile = (over: Record<string, unknown> = {}) => ({
  user: {
    id: 'u9',
    displayName: 'Ada',
    bio: 'Teaches waves.',
    createdAt: '2026-07-01T00:00:00Z',
  },
  projects: [
    {
      project: { id: 'p1', title: 'Physics' },
      decks: [
        {
          id: 'd1',
          title: 'Waves',
          permalinkSlug: 'waves-abc123',
          slideOrder: ['s1'],
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ],
  canEdit: false,
  ...over,
})

const session = (id: string) => ({
  status: 200,
  body: {
    user: {
      id,
      displayName: id === 'u9' ? 'Ada' : 'Root',
      email: `${id}@example.com`,
      planTier: 'free',
      profileVisibility: 'public',
    },
    accessToken: 't',
  },
})

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

/** Renders /u/u9. `viewer` is the signed-in user id, or null for anonymous. */
const renderPage = ({
  status = 200,
  body = profile(),
  viewer = null as string | null,
  routes = {} as Record<string, Handler>,
} = {}) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () => (viewer ? session(viewer) : { status: 401 }),
    '/api/users/u9': () => (status === 200 ? { status, body } : { status }),
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/u/u9']}>
      <AuthProvider>
        <Routes>
          <Route path="/u/:userId" element={<ProfilePage />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('ProfilePage', () => {
  it('shows the user, bio, and lectures grouped by project', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
    expect(screen.getByText('Teaches waves.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Physics' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Waves/ })).toHaveAttribute(
      'href',
      '/d/waves-abc123',
    )
  })

  it('reads the same for missing and private profiles', async () => {
    renderPage({ status: 404 })
    expect(
      await screen.findByText('This profile does not exist or is private.'),
    ).toBeVisible()
  })

  it('offers no Settings to a stranger', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('sends the owner to the canonical settings route', async () => {
    // Your own settings have one URL, whoever links to them.
    renderPage({ body: profile({ canEdit: true }), viewer: 'u9' })

    expect(
      await screen.findByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('href', '/app/settings')
  })

  it("names the account in the path when an admin opens someone else's", async () => {
    // canEdit without ownership means an admin is looking (ADMIN-5); the
    // settings page confirms on entry and audits from then on.
    renderPage({ body: profile({ canEdit: true }), viewer: 'root' })

    expect(
      await screen.findByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('href', '/app/settings/u9')
  })

  it('never offers editing in place', async () => {
    // The name and bio are edited on the settings page; two places to change
    // one field is how they drift apart.
    renderPage({ body: profile({ canEdit: true }), viewer: 'u9' })
    await screen.findByRole('heading', { name: 'Ada' })

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByLabelText('Display name')).toBeNull()
  })
})
