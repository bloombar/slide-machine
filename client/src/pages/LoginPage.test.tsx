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

// Records that the shared component was the thing rendered, while still
// rendering the real form so every other test here exercises it for real.
const signInFormSpy = vi.hoisted(() => vi.fn())
vi.mock('../components/SignInForm', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../components/SignInForm')>()
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      signInFormSpy(props)
      return actual.default(props)
    },
  }
})

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
  // The form itself is SignInForm (AUTH-8), shared with the sign-in dialog.
  // This spies on the module both surfaces import, so it fails if this page
  // ever renders its own copy of the form instead of that component —
  // which a testid assertion alone would not catch, since a copy-paste
  // carries the testid with it. SignInDialog.test.tsx makes the same
  // assertion on the dialog side; between them the two cannot drift apart
  // without one of them going red.
  it('renders the shared SignInForm component itself', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    renderLogin()
    await screen.findByTestId('sign-in-form')
    expect(signInFormSpy).toHaveBeenCalled()
  })

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

  it('returns to where the visitor was headed, not to /app', async () => {
    // A link from outside the app — an assistant pointing at one slide
    // (docs/MCP.md) — sends someone here with a destination in hand. Landing
    // them on the home page instead loses it: they arrived to see one thing.
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 401 }),
      '/api/auth/login': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
    })
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { from: '/d/week-4?slide=s2' } },
        ]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/app" element={<div>APP HOME</div>} />
            <Route path="/d/:slug" element={<div>THE LECTURE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: /sign in/i })
    submit()

    expect(await screen.findByText('THE LECTURE')).toBeInTheDocument()
    expect(screen.queryByText('APP HOME')).not.toBeInTheDocument()
  })

  it('surfaces a failed Google sign-in from the callback redirect', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    render(
      <MemoryRouter initialEntries={['/login?error=google_auth_failed']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in with Google — try again',
    )
  })
})
