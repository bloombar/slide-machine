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
    // The query string comes along. Most guarded routes carry their whole
    // identity in the path, but not all: an OAuth consent screen IS its
    // `?request=` parameter, and sending someone to sign in used to drop it —
    // so they signed in and landed on a page that no longer knew what it was
    // asked.
    return (
      <Navigate
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    )
  }
  return children
}
