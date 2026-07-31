/**
 * Public landing page: product tagline and a sign-in call to action.
 * Signed-in users are taken straight to their home screen instead.
 */
import { Link, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'

export default function LandingPage() {
  const { status } = useAuth()
  const { t } = useTranslation()

  if (status === 'restoring') {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        {t('common.loading')}
      </div>
    )
  }
  if (status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <NavLocaleSwitcher />
      <h1 className="text-4xl font-bold tracking-tight">
        {t('landing.title')}
      </h1>
      <p className="text-slate-600">{t('landing.tagline')}</p>
      <Link
        to="/login"
        className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-medium text-white"
      >
        <LogIn className="h-5 w-5" aria-hidden />
        {t('landing.cta')}
      </Link>
    </div>
  )
}
