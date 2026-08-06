/**
 * Unit tests for the pages a mailed link lands on (AUTH-3/AUTH-4) and the
 * verification notice in account settings.
 *
 * What matters at this level is that each page says the right thing for each
 * outcome — and, for the reset flow, that it never phrases a known address
 * differently from an unknown one, since the server deliberately answers both
 * the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import VerifyEmailPage from './VerifyEmailPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import ResetPasswordPage from './ResetPasswordPage'
import EmailVerificationNotice from '../components/EmailVerificationNotice'
import * as authApi from '../api/auth'
import * as runtimeConfig from '../runtime-config'

vi.mock('../auth/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../auth/AuthContext')>(
    '../auth/AuthContext',
  )
  return {
    ...actual,
    useAuth: () => ({
      status: 'anonymous',
      user: null,
      updateUser: vi.fn(),
    }),
  }
})

const at = (search: string, ui: React.ReactElement) => {
  window.history.replaceState({}, '', `/${search}`)
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>{ui}</MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(runtimeConfig, 'getMailEnabled').mockReturnValue(true)
})

describe('VerifyEmailPage (AUTH-3)', () => {
  it('confirms the address from the token in the link', async () => {
    const verify = vi
      .spyOn(authApi, 'verifyEmail')
      .mockResolvedValue({ id: 'u1', emailVerified: true } as never)
    at('?token=abc123', <VerifyEmailPage />)
    expect(await screen.findByText(/your address is confirmed/i)).toBeVisible()
    expect(verify).toHaveBeenCalledWith('abc123')
  })

  it('spends the token once, even though effects run twice in development', async () => {
    const verify = vi
      .spyOn(authApi, 'verifyEmail')
      .mockResolvedValue({ id: 'u1' } as never)
    const { rerender } = at('?token=abc123', <VerifyEmailPage />)
    rerender(
      <MemoryRouter>
        <VerifyEmailPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1))
  })

  it('says a used or expired link is no longer valid', async () => {
    vi.spyOn(authApi, 'verifyEmail').mockRejectedValue(new Error('nope'))
    at('?token=stale', <VerifyEmailPage />)
    expect(await screen.findByText(/no longer valid/i)).toBeVisible()
  })

  it('says so when the link carries no token at all', async () => {
    at('', <VerifyEmailPage />)
    expect(screen.getByText(/missing its token/i)).toBeVisible()
  })
})

describe('ForgotPasswordPage (AUTH-4)', () => {
  it('says the same thing whatever the address turns out to be', async () => {
    const ask = vi.spyOn(authApi, 'forgotPassword').mockResolvedValue()
    at('', <ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send the link' }))
    // "If that address has an account…" — never a confirmation that it does
    expect(
      await screen.findByText(/if that address has an account/i),
    ).toBeVisible()
    expect(ask).toHaveBeenCalledWith('ada@example.com')
  })

  it('says up front when the server cannot send mail', () => {
    vi.spyOn(runtimeConfig, 'getMailEnabled').mockReturnValue(false)
    at('', <ForgotPasswordPage />)
    expect(screen.getByText(/cannot send email/i)).toBeVisible()
    // Promising a link it could never deliver would be worse than saying no
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeDisabled()
  })
})

describe('ResetPasswordPage (AUTH-4)', () => {
  it('sets the new password from the token in the link', async () => {
    const reset = vi.spyOn(authApi, 'resetPassword').mockResolvedValue()
    at('?token=abc123', <ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'brandnewpass1' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Save the new password' }),
    )
    expect(await screen.findByText(/your password is set/i)).toBeVisible()
    expect(reset).toHaveBeenCalledWith('abc123', 'brandnewpass1')
  })

  it('reports an expired link rather than a blank failure', async () => {
    vi.spyOn(authApi, 'resetPassword').mockRejectedValue(new Error('nope'))
    at('?token=stale', <ResetPasswordPage />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'brandnewpass1' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Save the new password' }),
    )
    expect(await screen.findByText(/may have expired/i)).toBeVisible()
  })

  it('offers no form at all without a token', () => {
    at('', <ResetPasswordPage />)
    expect(screen.getByText(/missing its token/i)).toBeVisible()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })
})

describe('EmailVerificationNotice (AUTH-3)', () => {
  it('says nothing to do once the address is confirmed', () => {
    render(<EmailVerificationNotice email="ada@example.com" verified />)
    expect(screen.getByText('Confirmed')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers another link while it is not', async () => {
    const resend = vi
      .spyOn(authApi, 'resendVerification')
      .mockResolvedValue({ sent: true, alreadyVerified: false })
    render(<EmailVerificationNotice email="ada@example.com" verified={false} />)
    expect(screen.getByText(/ada@example.com/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Send another link' }))
    expect(await screen.findByText(/check your email/i)).toBeVisible()
    expect(resend).toHaveBeenCalled()
  })

  it('reports a failure rather than pretending it sent', async () => {
    vi.spyOn(authApi, 'resendVerification').mockRejectedValue(new Error('no'))
    render(<EmailVerificationNotice email="ada@example.com" verified={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send another link' }))
    expect(await screen.findByRole('alert')).toBeVisible()
  })

  it('does not offer a link a mail-less server could not send', () => {
    vi.spyOn(runtimeConfig, 'getMailEnabled').mockReturnValue(false)
    render(<EmailVerificationNotice email="ada@example.com" verified={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/cannot send email/i)).toBeVisible()
  })
})
