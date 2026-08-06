/**
 * Landing page for the verification link (AUTH-3). The token in the URL is the
 * credential, so this works whether or not the visitor is signed in — people
 * click mail links in whichever browser is in front of them.
 *
 * The check runs once on arrival. A link that has already been used, or has
 * expired, is one message either way: saying which would tell a stranger
 * something about tokens that once existed.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { verifyEmail } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'

type State = 'checking' | 'done' | 'error' | 'missing'

export default function VerifyEmailPage() {
  const { t } = useTranslation()
  const { status, updateUser } = useAuth()
  // Read the token from the URL rather than a router hook, so this page can
  // be rendered outside a data router in tests.
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [state, setState] = useState<State>(token ? 'checking' : 'missing')
  // React 18 mounts effects twice in development; spending the token on the
  // first pass would make the second report an invalid link.
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verifyEmail(token)
      .then(user => {
        setState('done')
        // A signed-in session still says unverified until it hears otherwise
        if (status === 'authenticated') updateUser(user)
      })
      .catch(() => setState('error'))
  }, [token, status, updateUser])

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('auth.verify.title')}</h1>
        <NavLocaleSwitcher />
      </div>

      {state === 'checking' && (
        <p role="status" className="text-sm text-slate-600">
          {t('auth.verify.checking')}
        </p>
      )}
      {state === 'done' && (
        <p role="status" className="text-sm text-slate-700">
          {t('auth.verify.done')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {t('auth.verify.error')}
        </p>
      )}
      {state === 'missing' && (
        <p role="alert" className="text-sm text-red-600">
          {t('auth.verify.missingToken')}
        </p>
      )}

      <p className="text-sm">
        <Link
          to={status === 'authenticated' ? '/app' : '/login'}
          className="text-indigo-600"
        >
          {t('auth.verify.continue')}
        </Link>
      </p>
    </div>
  )
}
