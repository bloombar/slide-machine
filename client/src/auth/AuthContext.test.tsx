/**
 * Unit tests for AuthContext: session restore on boot, anonymous
 * fallback, and logout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { setAccessToken } from './token'
import { mockFetchRoutes } from '../test/fetch-mock'

const authBody = {
  user: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
  accessToken: 'tok',
}

function Probe() {
  const { status, user, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.displayName ?? 'none'}</span>
      <button onClick={() => void logout()}>out</button>
    </div>
  )
}

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider', () => {
  it('restores the session on boot when the refresh cookie is valid', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 200, body: authBody }),
    })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(screen.getByTestId('user')).toHaveTextContent('Ada')
  })

  it('lands anonymous when refresh fails', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    expect(await screen.findByText('anonymous')).toBeInTheDocument()
  })

  it('clears user and state on logout', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 200, body: authBody }),
      '/api/auth/logout': () => ({ status: 204 }),
    })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await screen.findByText('authenticated')

    fireEvent.click(screen.getByText('out'))

    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })
})
