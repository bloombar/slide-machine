/**
 * The deployment-wide session-telemetry view (SPEC EVAL-1): every live
 * capture session in the window, how it performed, and how it ended.
 *
 * This is the study runbook's weekly check made visible — "a telemetry
 * record exists for every session that ran" — plus the excludable-session
 * count that the study's exclusion rule would act on. Telemetry carries no
 * student identity; browser-engine sessions open no server socket and read
 * as "Unknown".
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { TelemetryOverviewResponse } from '@slide-machine/shared'
import {
  fetchTelemetryOverview,
  telemetryExportPath,
  type TelemetryWindowQuery,
} from '../api/telemetry'
import {
  formatDurationMs,
  formatMs,
  EndBadge,
} from '../components/admin/TelemetryPanel'

/** Windows an operator actually asks for, matching the cost page. */
const RANGES = [
  { label: 'All time', days: null },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 7 days', days: 7 },
] as const

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** The window `days` means, resolved against the clock — from an effect or a
 * handler, never during render (same reasoning as the cost page). */
const windowFor = (days: number | null): TelemetryWindowQuery =>
  days ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}

/** Loaded data, tagged with the period it is for, so switching period never
 * shows old figures under a new heading. The export link reuses the fetched
 * window so the CSV covers exactly what the page shows. */
interface Loaded {
  days: number | null
  window: TelemetryWindowQuery
  data: TelemetryOverviewResponse | null
  failed: boolean
}

export default function AdminTelemetryPage() {
  const [days, setDays] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let live = true
    const window = windowFor(days)
    fetchTelemetryOverview(window)
      .then(
        body => live && setLoaded({ days, window, data: body, failed: false }),
      )
      .catch(
        () => live && setLoaded({ days, window, data: null, failed: true }),
      )
    return () => {
      live = false
    }
  }, [days])

  const current = loaded?.days === days ? loaded : null
  const data = current?.data ?? null
  const failed = current?.failed ?? false

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Telemetry</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Period
            <select
              value={days ?? ''}
              onChange={e =>
                setDays(e.target.value ? Number(e.target.value) : null)
              }
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {RANGES.map(r => (
                <option key={r.label} value={r.days ?? ''}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <a
            href={telemetryExportPath(current?.window ?? {})}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </a>
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-red-600">
          Could not load telemetry.
        </p>
      )}
      {!failed && !data && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Sessions"
              value={String(data.totals.sessions)}
              hint="Live capture sessions in this period"
            />
            <Stat
              label="Stopped cleanly"
              value={String(data.totals.stopped)}
              hint="Ended by a deliberate stop"
            />
            <Stat
              label="Crashed or abandoned"
              value={String(data.totals.crashed + data.totals.abandoned)}
              hint="Ended without a stop"
            />
            <Stat
              label="Excludable"
              value={String(data.totals.excludable)}
              hint="Per the study's exclusion rule"
            />
          </div>

          {!data.sessions.length ? (
            <p className="mt-6 text-slate-500">
              No live sessions recorded in this period.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2">
                      Lecture
                    </th>
                    <th scope="col" className="py-2">
                      Started
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Duration
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Phrases
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Final. p50/p95
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Gen. p50/p95
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Errors
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Restarts
                    </th>
                    <th scope="col" className="py-2 pl-3">
                      Ended
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map(s => (
                    <tr key={s.sessionId} className="border-t border-slate-100">
                      <td className="max-w-48 truncate py-2 pr-2">
                        {s.deckId ? (
                          <Link
                            to={`/app/admin/decks/${s.deckId}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {s.deckName?.trim() || 'Untitled lecture'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {s.startedAt
                          ? new Date(s.startedAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatDurationMs(s.wallDurationMs)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.phraseCount}
                      </td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">
                        {formatMs(s.finalization.p50Ms)} /{' '}
                        {formatMs(s.finalization.p95Ms)}
                      </td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">
                        {formatMs(s.generation.p50Ms)} /{' '}
                        {formatMs(s.generation.p95Ms)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.providerErrors.unavailable +
                          s.providerErrors.other +
                          s.sttErrors}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.sttRestarts}
                      </td>
                      <td className="py-2 pl-3 whitespace-nowrap">
                        <EndBadge reason={s.endReason} />
                        {s.excluded && (
                          <span
                            title="Matches the study's exclusion rule: a generation outage over 5 minutes or repeated transcription failures."
                            className="ml-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
                          >
                            excluded
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-slate-400">
            Telemetry records what the machine did — never who was watching.
            Sessions from the in-browser speech engine have no server-side end
            signal and show as “Unknown”.
          </p>
        </>
      )}
    </div>
  )
}
