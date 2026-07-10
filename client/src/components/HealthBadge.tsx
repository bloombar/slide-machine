/**
 * API health widget: fetches /api/health and shows a status badge —
 * the original walking-skeleton check, now part of the landing page.
 */
import { useEffect, useState } from 'react'
import type { HealthResponse } from '@slide-machine/shared'
import { config } from '../config'

const badgeStyles: Record<
  HealthResponse['status'] | 'loading' | 'error',
  string
> = {
  ok: 'bg-green-100 text-green-800',
  degraded: 'bg-yellow-100 text-yellow-800',
  loading: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-800',
}

export default function HealthBadge() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/health`)
      .then(res => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  const status = error ? 'error' : (health?.status ?? 'loading')

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3">
      <span className="text-sm text-slate-400">API status</span>
      <span
        data-testid="health-badge"
        className={`rounded-full px-3 py-1 text-sm font-medium ${badgeStyles[status]}`}
      >
        {error ? 'unreachable' : status === 'loading' ? 'checking…' : status}
      </span>
      {health && (
        <span className="text-sm text-slate-400">mongo: {health.mongo}</span>
      )}
    </div>
  )
}
