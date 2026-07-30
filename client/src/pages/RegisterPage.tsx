/**
 * Registration form (AUTH-1 email+password). Registration signs the user
 * in immediately; email verification (AUTH-3) arrives in a later phase.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../i18n/apiError'
import GoogleSignInButton from '../components/GoogleSignInButton'

export default function RegisterPage() {
  const { status, register } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to="/app" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password, displayName)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err, t, 'auth.errors.register'))
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
        <h1 className="text-2xl font-bold">{t('auth.createAccount')}</h1>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          {t('auth.displayName')}
          <input
            required
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
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
            minLength={8}
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
          {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </button>
        <GoogleSignInButton action={t('auth.signUp')} />
        <p className="text-sm text-slate-500">
          {t('auth.alreadyRegistered')}{' '}
          <Link to="/login" className="text-indigo-600">
            {t('auth.signInLink')}
          </Link>
        </p>
      </form>
    </div>
  )
}
