/**
 * The deployment-wide cost view (SPEC BILL-7): what this installation costs,
 * what it costs per user, per lecture, per project and per student, and who
 * the largest spenders are.
 *
 * Averages are per **active** entity, never per existing one. An account that
 * spent nothing is not a cheap user — it is not a user of anything — and
 * dividing by dormant accounts would make a deployment look cheaper the more
 * of them it accumulates, which is exactly backwards for a figure an operator
 * uses to decide what to do next.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { CostOverviewResponse } from '@slide-machine/shared'
import {
  costExportPath,
  fetchCostOverview,
  type CostWindowQuery,
} from '../api/cost'
import { formatMoney } from '../components/admin/CostPanel'

const formatCount = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value)

/** Windows an operator actually asks for, rather than a date picker nobody
 * wants to fill in twice. */
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

/** The window `days` means, resolved against the clock. Called from an effect
 * and an event handler, never during render: "now" is not a render-stable
 * value, and reading it while rendering makes the same component render
 * differently for no reason the props explain. */
const windowFor = (days: number | null): CostWindowQuery =>
  days ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}

/** Loaded data, tagged with the period it is for — so switching period never
 * shows the old figures under the new heading, and no state has to be cleared
 * synchronously inside an effect to prevent it. */
interface Loaded {
  days: number | null
  /** The window the figures on screen were actually fetched with. The export
   * link reuses it rather than re-reading the clock, so the CSV covers the
   * same period the page is showing instead of one a few seconds narrower. */
  window: CostWindowQuery
  data: CostOverviewResponse | null
  failed: boolean
}

export default function AdminCostPage() {
  const [days, setDays] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let live = true
    const window = windowFor(days)
    fetchCostOverview(window)
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
        <h1 className="text-2xl font-bold">Cost</h1>
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
            href={costExportPath(current?.window ?? {})}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </a>
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-red-600">
          Could not load cost.
        </p>
      )}
      {!failed && !data && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total" value={formatMoney(data.totals.total)} />
            <Stat
              label="Instructors"
              value={formatMoney(data.totals.instructor)}
              hint="Caused by owners"
            />
            <Stat
              label="Audiences"
              value={formatMoney(data.totals.audience)}
              hint="Caused by viewers"
            />
            <Stat
              label="Cost avoided"
              value={formatMoney(data.totals.cache.estimatedAvoided)}
              hint="Estimated, by caching"
            />
          </div>

          <h2 className="mt-8 mb-3 text-lg font-semibold text-slate-700">
            Averages
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Per user"
              value={formatMoney(data.averages.perUser)}
              hint={`${formatCount(data.activeUsers)} active`}
            />
            <Stat
              label="Per lecture"
              value={formatMoney(data.averages.perLecture)}
              hint={`${formatCount(data.lecturesWithSpend)} with spend`}
            />
            <Stat
              label="Per project"
              value={formatMoney(data.averages.perProject)}
              hint={`${formatCount(data.projectsWithSpend)} with spend`}
            />
            <Stat
              label="Per student"
              value={formatMoney(data.averages.perRegisteredStudent)}
              hint={`${formatCount(data.activeStudents)} registered`}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Averages divide by entities that actually spent something in the
            period, not by everything that exists. Per-student figures cover{' '}
            <strong>registered</strong> students only —{' '}
            {formatCount(data.totals.anonymousEvents)} events came from viewers
            with no account, who are counted but never identified.
          </p>

          <h2 className="mt-8 mb-3 text-lg font-semibold text-slate-700">
            Largest spenders
          </h2>
          {data.topSpenders.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing metered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2">
                      Account
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topSpenders.map(row => (
                    <tr key={row.payerId} className="border-t border-slate-100">
                      <td className="py-2">
                        <Link
                          to={`/app/admin/users/${row.payerId}`}
                          className="text-indigo-700 hover:underline"
                        >
                          {row.email ?? row.displayName ?? row.payerId}
                        </Link>
                        {!row.email && (
                          <span className="ml-2 text-xs text-slate-400">
                            account deleted
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatMoney(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
