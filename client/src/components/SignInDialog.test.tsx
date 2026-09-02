/**
 * Unit tests for the sign-in dialog (AUTH-8): the Modal wrapper around the
 * shared SignInForm — a feature-specific title, focus/Escape/backdrop
 * dismissal, and that a successful sign-in closes it and nothing else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import SignInDialog from './SignInDialog'
import { mockFetchRoutes } from '../test/fetch-mock'

// Records that the shared component was the thing rendered, while still
// rendering the real form so every other test here exercises it for real.
// LoginPage.test.tsx makes the matching assertion for /login.
const signInFormSpy = vi.hoisted(() => vi.fn())
vi.mock('./SignInForm', async importOriginal => {
  const actual = await importOriginal<typeof import('./SignInForm')>()
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      signInFormSpy(props)
      return actual.default(props)
    },
  }
})

const mount = (
  feature: 'playback' | 'narration' | 'translation',
  onClose: () => void,
) =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <SignInDialog feature={feature} onClose={onClose} />
      </AuthProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignInDialog', () => {
  it('names the feature that was reached for', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    mount('playback', () => {})
    expect(
      await screen.findByRole('dialog', {
        name: 'Playback needs an account',
      }),
    ).toBeInTheDocument()
  })

  it('says narration, or translation, for those features', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    const { unmount } = mount('narration', () => {})
    expect(
      await screen.findByRole('dialog', {
        name: 'Narration needs an account',
      }),
    ).toBeInTheDocument()
    unmount()

    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    mount('translation', () => {})
    expect(
      await screen.findByRole('dialog', {
        name: 'Translated viewing needs an account',
      }),
    ).toBeInTheDocument()
  })

  // The dialog is a Modal around the exact SignInForm /login renders. The
  // spy is what makes that structural — it fails if the dialog ever grows
  // its own copy of the form, which a testid check alone would not catch,
  // since a copy-paste carries the testid with it. The field assertions
  // below then say what that shared form actually offers.
  it('renders the same SignInForm /login uses, Google option included', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    mount('narration', () => {})
    await screen.findByTestId('sign-in-form')
    expect(signInFormSpy).toHaveBeenCalled()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /sign in with google/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Forgot your password?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create one' })).toBeInTheDocument()
  })

  it('focuses the email field on open', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    mount('playback', () => {})
    await screen.findByTestId('sign-in-form')
    expect(screen.getByLabelText(/email/i)).toHaveFocus()
  })

  it('dismisses on Escape', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    const onClose = vi.fn()
    mount('playback', onClose)
    await screen.findByTestId('sign-in-form')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismisses on a backdrop click', async () => {
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    const onClose = vi.fn()
    mount('playback', onClose)
    await screen.findByTestId('sign-in-form')
    // Modal's backdrop: the one <div aria-hidden> in a form with no icons of
    // its own (the Google glyph is an <svg aria-hidden>, not a div).
    fireEvent.click(document.body.querySelector('div[aria-hidden]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a successful sign-in and fires nothing else', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 401 }),
      '/api/auth/login': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
    })
    const onClose = vi.fn()
    mount('playback', onClose)
    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: 'ada@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'longenough1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows the server error inline and stays open on a failed sign-in', async () => {
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
    const onClose = vi.fn()
    mount('playback', onClose)
    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: 'ada@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password',
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
