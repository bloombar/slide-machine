/**
 * Unit tests for the profile page: visible lectures grouped by project,
 * the indistinguishable not-found/private state, who sees the Edit and
 * Settings buttons, and the two save paths — the owner's own action and
 * the admin's audited endpoint behind a confirmation. The Settings button
 * is the admin's way into another user's account settings (ADMIN-5), so
 * it too confirms once before the modal opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('offers no Edit or Settings to a stranger', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Ada' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  })

  it('lets the owner edit the display name and bio', async () => {
    let sent: unknown
    renderPage({
      body: profile({ canEdit: true }),
      viewer: 'u9',
      routes: {
        '/api/actions/user.updateProfile': init => {
          sent = JSON.parse(String(init?.body))
          return {
            status: 200,
            body: {
              id: 'u9',
              displayName: 'Ada L.',
              email: 'u9@example.com',
              bio: 'Now with optics.',
              planTier: 'free',
              profileVisibility: 'public',
            },
          }
        },
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const name = screen.getByLabelText('Display name')
    const bio = screen.getByLabelText('Bio')
    expect(name).toHaveValue('Ada')
    expect(bio).toHaveValue('Teaches waves.')

    fireEvent.change(name, { target: { value: 'Ada L.' } })
    fireEvent.change(bio, { target: { value: 'Now with optics.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(sent).toEqual({ displayName: 'Ada L.', bio: 'Now with optics.' }),
    )
    // The form closes and the page shows the saved values
    expect(await screen.findByRole('heading', { name: 'Ada L.' })).toBeVisible()
    expect(screen.getByText('Now with optics.')).toBeVisible()
  })

  it('rejects a blank display name without calling the server', async () => {
    const { calls } = renderPage({
      body: profile({ canEdit: true }),
      viewer: 'u9',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Display name is required.',
    )
    expect(calls.some(url => url.includes('user.updateProfile'))).toBe(false)
  })

  it('discards edits on cancel', async () => {
    renderPage({ body: profile({ canEdit: true }), viewer: 'u9' })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeVisible()
  })

  it('opens account settings for the owner without a confirmation', async () => {
    renderPage({ body: profile({ canEdit: true }), viewer: 'u9' })
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(
      await screen.findByRole('heading', { name: 'Settings' }),
    ).toBeVisible()
    expect(screen.getByText('u9@example.com')).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it("opens another user's settings for an admin, once confirmed", async () => {
    const { calls } = renderPage({
      body: profile({ canEdit: true }),
      viewer: 'root',
      routes: {
        '/api/admin/users/u9': () => ({
          status: 200,
          body: {
            user: {
              id: 'u9',
              email: 'ada@example.com',
              displayName: 'Ada',
              planTier: 'free',
              profileVisibility: 'public',
              locale: 'en',
            },
            projectCount: 0,
            deckCount: 0,
            banned: false,
          },
        }),
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    // Nothing is loaded until the audit notice is acknowledged
    const ask = await screen.findByRole('alertdialog', {
      name: "Edit this user's settings?",
    })
    expect(ask).toHaveTextContent(/recorded in the audit log/)
    expect(calls.some(url => url.includes('/api/admin/users/'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    expect(await screen.findByText('ada@example.com')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(/as an admin/)
  })

  it('opens no settings when the admin declines the notice', async () => {
    const { calls } = renderPage({
      body: profile({ canEdit: true }),
      viewer: 'root',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(calls.some(url => url.includes('/api/admin/users/'))).toBe(false)
  })

  it('saves an admin edit through the audited endpoint after confirming', async () => {
    let patched: unknown
    renderPage({
      body: profile({ canEdit: true }),
      viewer: 'root',
      routes: {
        '/api/admin/users/u9': init => {
          patched = JSON.parse(String(init?.body))
          return { status: 204 }
        },
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Nothing is written until the audit notice is acknowledged
    const confirm = await screen.findByRole('alertdialog', {
      name: "Edit this user's profile?",
    })
    expect(confirm).toHaveTextContent(/recorded in the audit log/)
    expect(patched).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() =>
      expect(patched).toEqual({
        displayName: 'Ada Lovelace',
        bio: 'Teaches waves.',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeVisible()
  })

  it('writes nothing when the admin cancels the confirmation', async () => {
    const { calls } = renderPage({
      body: profile({ canEdit: true }),
      viewer: 'root',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alertdialog')
    // The dialog's own Cancel, not the form's, is the last one rendered
    const cancels = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1]!)

    expect(calls.some(url => url.includes('/api/admin/users/'))).toBe(false)
    // The form stays open so the edit is not lost
    expect(screen.getByLabelText('Display name')).toBeVisible()
  })

  it('reports a failed save and keeps the form open', async () => {
    renderPage({
      body: profile({ canEdit: true }),
      viewer: 'u9',
      routes: {
        '/api/actions/user.updateProfile': () => ({
          status: 400,
          body: {
            error: {
              code: 'invalid_input',
              message: 'Display name is required',
            },
          },
        }),
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Display name is required',
    )
    expect(screen.getByLabelText('Display name')).toBeVisible()
  })
})
