/**
 * "I forgot my password" (AUTH-4). Asks for an address and says the same
 * thing whatever comes back — the server answers identically for a registered
 * address and an unknown one, so this page must not undo that by phrasing the
 * two differently.
 *
 * A server with no mail configured says so up front rather than promising a
 * link it can never deliver.
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { forgotPassword } from '../api/auth'
import { getMailEnabled } from '../runtime-config'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const mailEnabled = getMailEnabled()

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await forgotPassword(email)
      setSent(true)
    } catch {
      setError(t('auth.forgot.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('auth.forgot.title')}</h1>
        <NavLocaleSwitcher />
      </div>

      {!mailEnabled && (
        <p role="status" className="text-sm text-amber-700">
          {t('auth.forgot.unavailable')}
        </p>
      )}

      {sent ? (
        <p role="status" className="text-sm text-slate-700">
          {t('auth.forgot.sent')}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">{t('auth.forgot.intro')}</p>
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
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !mailEnabled}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {submitting ? t('auth.forgot.sending') : t('auth.forgot.submit')}
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
