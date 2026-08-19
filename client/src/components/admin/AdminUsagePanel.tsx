/**
 * The target account's service usage on its admin page — the same meters the
 * account's own footer badge shows (BILL-4), read through the admin-only
 * endpoint rather than the self-only `user.usage` action.
 *
 * Defaults to the current billing period because that is what the caps bind
 * against; "All time" answers the other operator question — what has this
 * account consumed since it existed — and shows plain totals, because a
 * per-period cap drawn against a lifetime figure would read as a huge overrun.
 *
 * Deliberately separate from the cost panel below it: these numbers come from
 * the allowance counters (billable spend only, per billing period), while the
 * cost table reads the all-time event ledger, cache hits included. Merging
 * them would put two different accountings under one heading.
 */
import { useEffect, useState } from 'react'
import type {
  UsageMetricSummary,
  UsageSummaryResponse,
  UsageWindow,
} from '@slide-machine/shared'
import { fetchAdminUserUsage } from '../../api/admin'
import UsageMeter from '../UsageMeter'

/** In UTC, because that is the calendar the rollover itself follows — a free
 * account resets at UTC midnight, which a local rendering would shift by a
 * day for most of the world. */
const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))

/** One titled block of meters, mirroring the badge's instructor/audience
 * split — the two draw on different pools, so one flat list would hide why a
 * busy audience never exhausts the owner's own budget. */
function MeterGroup({
  title,
  hint,
  metrics,
}: {
  title: string
  hint?: string
  metrics: UsageMetricSummary[]
}) {
  if (!metrics.length) return null
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {metrics.map(m => (
        <UsageMeter key={m.metric} metric={m} />
      ))}
    </div>
  )
}

/** What has been loaded, tagged with the request it answers — same discipline
 * as CostPanel, so a toggle never shows one window's numbers under the
 * other's caption. */
interface Loaded {
  key: string
  summary: UsageSummaryResponse | null
  failed: boolean
}

export default function AdminUsagePanel({ userId }: { userId: string }) {
  const [timeframe, setTimeframe] = useState<UsageWindow>('period')
  const key = `${userId}:${timeframe}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let live = true
    fetchAdminUserUsage(userId, timeframe)
      .then(body => live && setLoaded({ key, summary: body, failed: false }))
      .catch(() => live && setLoaded({ key, summary: null, failed: true }))
    return () => {
      live = false
    }
    // key encodes both inputs; the eslint rule cannot see through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = loaded?.key === key ? loaded : null
  const summary = current?.summary ?? null

  const windowButton = (value: UsageWindow, label: string) => (
    <button
      type="button"
      aria-pressed={timeframe === value}
      onClick={() => setTimeframe(value)}
      className={`rounded-md px-2 py-1 text-xs font-medium ${
        timeframe === value
          ? 'bg-slate-200 text-slate-800'
          : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <section
      data-testid="admin-usage-panel"
      className="mt-8 rounded-lg border border-slate-200 p-4"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-700">Service usage</h2>
        <div
          role="group"
          aria-label="Usage timeframe"
          className="flex gap-1 rounded-lg border border-slate-200 p-0.5"
        >
          {windowButton('period', 'Current period')}
          {windowButton('all', 'All time')}
        </div>
      </div>

      {current?.failed && (
        <p role="alert" className="text-sm text-red-600">
          Could not load usage.
        </p>
      )}
      {!current && <p className="text-sm text-slate-500">Loading…</p>}

      {summary && (
        <>
          <p className="mb-4 text-xs text-slate-500">
            {timeframe === 'period'
              ? `Spent against the ${summary.tier} plan's allowances since ` +
                `they last renewed. Resets ${formatDate(summary.resetAt)}.`
              : 'Everything the account has ever spent. Plan caps are per ' +
                'period, so only stored audio — a current holding — shows one.'}
          </p>
          <div className="flex flex-col gap-5">
            <MeterGroup
              title="Instructor allowances"
              metrics={summary.metrics.filter(
                m => m.allowance === 'instructor',
              )}
            />
            <MeterGroup
              title="Audience allowances"
              hint="Spent by viewers of this account's lectures, charged to it from a separate pool."
              metrics={summary.metrics.filter(m => m.allowance === 'audience')}
            />
          </div>
        </>
      )}
    </section>
  )
}
