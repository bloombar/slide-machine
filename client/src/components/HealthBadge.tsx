/**
 * API health bar in the sticky footer. Collapsed, it shows the compact
 * overall status ("API ok"). Clicked, it expands into a panel breaking the
 * status down by component — deployment mode, MongoDB, object storage,
 * Google Gemini, Google Speech-to-Text — plus the app version and uptime.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ComponentStatus,
  HealthComponent,
  HealthResponse,
} from '@slide-machine/shared'
import { config } from '../config'

type DisplayStatus = HealthResponse['status'] | 'loading' | 'error'

/** Dot color per status, shared by the summary and the component rows. */
const dotStyles: Record<DisplayStatus | ComponentStatus, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
  disabled: 'bg-slate-300',
  loading: 'bg-slate-300',
  error: 'bg-red-500',
}

type ComponentKey = keyof HealthResponse['components']

const componentLabels: Record<ComponentKey, string> = {
  mongo: 'MongoDB',
  storage: 'Storage',
  gemini: 'Google Gemini',
  stt: 'Google Speech-to-Text',
}

/** Human-friendly uptime, e.g. "3h 12m", "5m 8s", "42s". */
function formatUptime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s % 60}s`
  return `${s}s`
}

export default function HealthBadge() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)

  const fetchHealth = useCallback(() => {
    fetch(`${config.apiBaseUrl}/api/health`)
      .then(res => res.json() as Promise<HealthResponse>)
      .then(body => {
        setHealth(body)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])

  useEffect(fetchHealth, [fetchHealth])

  // Re-probe when the user opens the panel so the breakdown is current.
  const toggle = () => {
    setOpen(prev => {
      if (!prev) fetchHealth()
      return !prev
    })
  }

  const status: DisplayStatus = error ? 'error' : (health?.status ?? 'loading')
  const label = error
    ? 'unreachable'
    : status === 'loading'
      ? 'checking…'
      : status

  const components = health
    ? (Object.entries(health.components) as [ComponentKey, HealthComponent][])
    : []

  return (
    <div
      role="status"
      data-testid="health-bar"
      className="relative flex w-full justify-center"
    >
      {open && health && (
        <div
          data-testid="health-panel"
          className="absolute bottom-full left-1/2 z-40 mb-2 w-72 -translate-x-1/2 space-y-2 rounded-md border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-lg"
        >
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Environment</span>
            <span className="font-medium">{health.environment}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Version</span>
            <span className="font-mono">{health.version}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Uptime</span>
            <span>{formatUptime(health.uptime)}</span>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            {components.map(([key, comp]) => (
              <div
                key={key}
                data-testid={`health-component-${key}`}
                className="flex items-center justify-between gap-4"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${dotStyles[comp.status]}`}
                    aria-hidden
                  />
                  <span
                    className={
                      comp.status === 'disabled' ? 'text-slate-400' : ''
                    }
                  >
                    {componentLabels[key]}
                  </span>
                </span>
                <span className="text-slate-400">
                  {comp.detail ?? comp.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        disabled={!health}
        className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-500 hover:text-slate-700 disabled:hover:text-slate-500"
      >
        <span
          className={`h-2 w-2 rounded-full ${dotStyles[status]}`}
          aria-hidden
        />
        <span>API {label}</span>
        {health && <span aria-hidden>{open ? '▾' : '▸'}</span>}
      </button>
    </div>
  )
}
