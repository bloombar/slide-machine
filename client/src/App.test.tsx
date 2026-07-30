/**
 * Unit tests for the route table's profile entries: /u/:userId mounts the
 * profile page, and the retired /app/profile sends the signed-in user to
 * their own one so old links keep working.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { setAccessToken } from './auth/token'
import { mockFetchRoutes } from './test/fetch-mock'

const renderAt = (path: string) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: {
        user: {
          id: 'u1',
          displayName: 'Ada',
          email: 'ada@example.com',
          planTier: 'free',
          profileVisibility: 'public',
        },
        accessToken: 't',
      },
    }),
    '/api/health': () => ({
      status: 200,
      body: {
        status: 'ok',
        environment: 'test',
        version: '0',
        uptime: 1,
        components: {
          mongo: { status: 'ok', detail: 'connected' },
          storage: { status: 'ok', detail: 'local disk' },
          gemini: { status: 'disabled', detail: 'not configured' },
          stt: { status: 'disabled', detail: 'browser (client-side)' },
        },
      },
    }),
    '/api/users/u1': () => ({
      status: 200,
      body: {
        user: {
          id: 'u1',
          displayName: 'Ada',
          createdAt: '2026-07-01T00:00:00Z',
        },
        projects: [],
        canEdit: true,
      },
    }),
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('App routes', () => {
  it('mounts the profile page at /u/:userId', async () => {
    renderAt('/u/u1')
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
  })

  it('redirects /app/profile to the signed-in user’s own profile', async () => {
    const { calls } = renderAt('/app/profile')
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeVisible()
    // Landing on the profile page is what the fetch proves
    await vi.waitFor(() =>
      expect(calls.some(url => url.includes('/api/users/u1'))).toBe(true),
    )
  })
})
