/**
 * Compact API health bar: fetches /api/health once and reports the API
 * and MongoDB state. Rendered inside the sticky footer on every page.
 */
import { useEffect, useState } from 'react'
import type { HealthResponse } from '@slide-machine/shared'
import { config } from '../config'

type DisplayStatus = HealthResponse['status'] | 'loading' | 'error'

const dotStyles: Record<DisplayStatus, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-yellow-500',
  loading: 'bg-slate-300',
  error: 'bg-red-500',
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

  const status: DisplayStatus = error ? 'error' : (health?.status ?? 'loading')
  const label = error
    ? 'unreachable'
    : status === 'loading'
      ? 'checking…'
      : status

  return (
    <div
      data-testid="health-bar"
      className="flex w-full flex-nowrap items-center justify-center gap-2 text-xs whitespace-nowrap text-slate-500"
    >
      <span
        className={`h-2 w-2 rounded-full ${dotStyles[status]}`}
        aria-hidden
      />
      <span>API {label}</span>
      {health && <span>· mongo {health.mongo}</span>}
    </div>
  )
}
