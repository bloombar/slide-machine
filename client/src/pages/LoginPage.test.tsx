/**
 * Unit tests for the login form: successful sign-in redirects, server
 * errors render inline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import LoginPage from './LoginPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app" element={<div>APP HOME</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

const submit = () => {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: 'ada@example.com' },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: 'longenough1' },
  })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  it('signs in and redirects to /app', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 401 }),
      '/api/auth/login': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
    })

    renderLogin()
    await screen.findByRole('button', { name: /sign in/i })
    submit()

    expect(await screen.findByText('APP HOME')).toBeInTheDocument()
  })

  it('renders the server error message on bad credentials', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 401 }),
      '/api/auth/login': () => ({
        status: 401,
        body: {
          error: {
            code: 'invalid_credentials',
            message: 'Incorrect email or password',
          },
        },
      }),
    })

    renderLogin()
    await screen.findByRole('button', { name: /sign in/i })
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password',
    )
    expect(screen.queryByText('APP HOME')).not.toBeInTheDocument()
  })
})
