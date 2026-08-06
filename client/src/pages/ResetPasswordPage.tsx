/**
 * Setting a new password from a mailed link (AUTH-4). The token arrives in the
 * URL and is the only credential — the visitor is not signed in, and after the
 * reset nobody is: every session ends, which is the point when the person
 * resetting is recovering an account someone else got into.
 */
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { resetPassword } from '../api/auth'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch {
      setError(t('auth.reset.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('auth.reset.title')}</h1>
        <NavLocaleSwitcher />
      </div>

      {!token ? (
        <p role="alert" className="text-sm text-red-600">
          {t('auth.reset.missingToken')}
        </p>
      ) : done ? (
        <p role="status" className="text-sm text-slate-700">
          {t('auth.reset.done')}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            {t('auth.reset.newPassword')}
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
            {submitting ? t('auth.reset.saving') : t('auth.reset.submit')}
          </button>
        </form>
      )}

      <p className="text-sm">
        <Link to="/login" className="text-indigo-600">
          {t('auth.forgot.backToSignIn')}
        </Link>
      </p>
    </div>
  )
}
