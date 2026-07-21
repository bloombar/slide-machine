/**
 * Whether the signed-in user is an admin, resolved once per account via
 * GET /api/admin/status and cached for the session so the route guard
 * and navigation don't each refetch. Cosmetic only — the server's
 * requireAdmin middleware is the enforcement.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchAdminStatus } from '../api/admin'
import { ApiError } from '../api/http'

const cache = new Map<string, boolean>()

/** Clears the per-account cache (tests). */
export const resetAdminStatus = (): void => cache.clear()

/** true/false once known; null while the session or check is resolving. */
export function useIsAdmin(): boolean | null {
  const { status, user } = useAuth()
  const userId = user?.id
  // Render reads the cache directly; this state only exists so fetch
  // completions re-render, and to answer for uncached transient failures
  const [resolved, setResolved] = useState<{
    id: string
    isAdmin: boolean
  } | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || !userId || cache.has(userId)) return
    let cancelled = false
    fetchAdminStatus()
      .then(res => {
        cache.set(userId, res.isAdmin)
        if (!cancelled) setResolved({ id: userId, isAdmin: res.isAdmin })
      })
      .catch((err: unknown) => {
        // 403 is a definitive "no"; transient failures stay uncached so a
        // later mount can retry
        if (err instanceof ApiError && err.status === 403) {
          cache.set(userId, false)
        }
        if (!cancelled) setResolved({ id: userId, isAdmin: false })
      })
    return () => {
      cancelled = true
    }
  }, [status, userId])

  if (status === 'anonymous') return false
  if (status !== 'authenticated' || !userId) return null
  return (
    cache.get(userId) ?? (resolved?.id === userId ? resolved.isAdmin : null)
  )
}
