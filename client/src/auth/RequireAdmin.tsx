/**
 * Route guard for admin pages: waits for session restore and the admin
 * check, sends anonymous visitors to /login (remembering where they were
 * headed) and signed-in non-admins back to /app. Cosmetic only — the
 * server's requireAdmin middleware is the enforcement.
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const isAdmin = useIsAdmin()
  const location = useLocation()

  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  if (status === 'restoring' || isAdmin === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        Loading…
      </main>
    )
  }
  if (!isAdmin) {
    return <Navigate to="/app" replace />
  }
  return children
}
