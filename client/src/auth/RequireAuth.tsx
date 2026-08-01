/**
 * Route guard: waits for session restore, then either renders children
 * or redirects to /login remembering where the user was headed.
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (status === 'restoring') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        {t('common.loading')}
      </main>
    )
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return children
}
