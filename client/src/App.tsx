/**
 * Placeholder landing page for the walking skeleton: fetches /api/health
 * and renders the result, proving the client → API → MongoDB path (plus
 * Tailwind styling and shared-DTO imports) end to end.
 */
import { useEffect, useState } from 'react'
import type { HealthResponse } from '@slide-machine/shared'
import { config } from './config'

const badgeStyles: Record<
  HealthResponse['status'] | 'loading' | 'error',
  string
> = {
  ok: 'bg-green-100 text-green-800',
  degraded: 'bg-yellow-100 text-yellow-800',
  loading: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-800',
}

export default function App() {
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-slate-100">
      <h1 className="text-4xl font-bold tracking-tight">Slide Machine V2</h1>
      <p className="text-slate-400">Speak freely — the slides will follow.</p>
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
    </main>
  )
}
