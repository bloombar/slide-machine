/**
 * The sign-in form itself: email/password fields, the Google option, the
 * legal notice, and the forgot-password / create-account links. Server-side
 * validation is authoritative; errors from the API render inline.
 *
 * Extracted so `/login` and the sign-in dialog (AUTH-8) render the exact
 * same form rather than two copies that drift — the dialog is a Modal
 * wrapped around this, nothing more. What differs between the two callers
 * (the page's own `<h1>` and card chrome, versus the dialog's title and
 * panel) stays with them; everything a visitor actually fills in lives here.
 */
import { useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../i18n/apiError'
import GoogleSignInButton from './GoogleSignInButton'
import LegalConsentNotice from './LegalConsentNotice'

interface Props {
  /** Called after a successful sign-in. The form never navigates or closes
   * anything itself — `/login` sends the visitor on, the dialog just closes
   * — so each caller decides what "done" means. */
  onSuccess: () => void
  /** A pre-set error shown on mount, e.g. `/login` surfacing a failed
   * Google callback redirect. */
  initialError?: string | null
  /** Attached to the email field so a caller (the dialog's Modal) can focus
   * it on open; `/login` leaves this unset and relies on its own layout. */
  emailInputRef?: RefObject<HTMLInputElement | null>
}

export default function SignInForm({
  onSuccess,
  initialError = null,
  emailInputRef,
}: Props) {
  const { login } = useAuth()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      onSuccess()
    } catch (err) {
      setError(apiErrorMessage(err, t, 'auth.errors.signIn'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="sign-in-form"
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t('auth.email')}
        <input
          ref={emailInputRef}
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t('auth.password')}
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {submitting ? t('auth.signingIn') : t('auth.signIn')}
      </button>
      <GoogleSignInButton action={t('auth.signIn')} />
      <LegalConsentNotice action="signIn" />
      <p className="text-sm">
        <Link to="/forgot-password" className="text-indigo-600">
          {t('auth.forgotPassword')}
        </Link>
      </p>
      <p className="text-sm text-slate-500">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="text-indigo-600">
          {t('auth.createOne')}
        </Link>
      </p>
    </form>
  )
}
