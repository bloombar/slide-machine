/**
 * Sign-in form (AUTH-1 email+password). Server-side validation is
 * authoritative; errors from the API render inline.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../i18n/apiError'
import GoogleSignInButton from '../components/GoogleSignInButton'

export default function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // A failed Google callback redirects here with ?error=<code>
  const googleFailed =
    new URLSearchParams(location.search).get('error') === 'google_auth_failed'
  const [error, setError] = useState<string | null>(
    googleFailed ? t('auth.errors.google') : null,
  )
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to="/app" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate((location.state as { from?: string } | null)?.from ?? '/app', {
        replace: true,
      })
    } catch (err) {
      setError(apiErrorMessage(err, t, 'auth.errors.signIn'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="flex w-80 flex-col gap-4 rounded-lg border border-slate-200 p-8"
      >
        <h1 className="text-2xl font-bold">{t('auth.signIn')}</h1>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          {t('auth.email')}
          <input
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
        <p className="text-sm text-slate-500">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-indigo-600">
            {t('auth.createOne')}
          </Link>
        </p>
      </form>
    </div>
  )
}
