/**
 * Unit tests for the public profile page: visible lectures grouped by
 * project, and the indistinguishable not-found/private state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import PublicProfilePage from './PublicProfilePage'
import { mockFetchRoutes } from '../test/fetch-mock'

const profile = {
  user: { id: 'u9', displayName: 'Ada', createdAt: '2026-07-01T00:00:00Z' },
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
}

const renderPage = (status: number) => {
  mockFetchRoutes({
    '/api/auth/refresh': () => ({ status: 401 }),
    '/api/users/u9': () =>
      status === 200 ? { status, body: profile } : { status },
  })
  render(
    <MemoryRouter initialEntries={['/u/u9']}>
      <AuthProvider>
        <Routes>
          <Route path="/u/:userId" element={<PublicProfilePage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PublicProfilePage', () => {
  it('shows the user with lectures grouped by project', async () => {
    renderPage(200)
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Physics' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Waves/ })).toHaveAttribute(
      'href',
      '/d/waves-abc123',
    )
  })

  it('reads the same for missing and private profiles', async () => {
    renderPage(404)
    expect(
      await screen.findByText('This profile does not exist or is private.'),
    ).toBeVisible()
  })
})
