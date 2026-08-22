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
 *
 * The one thing that is not a read: an operator can hand the period's
 * allowances back (ADMIN-10) — the remedy for a bad generation run or a
 * lecture whose audience spent a term's budget in an afternoon. It changes
 * only the counters, never the plan and never the cost ledger, so what the
 * deployment spent still reads the same afterwards.
 */
import { useEffect, useState } from 'react'
import type {
  UsageMetricSummary,
  UsageSummaryResponse,
  UsageWindow,
} from '@slide-machine/shared'
import { fetchAdminUserUsage, resetAdminUserUsage } from '../../api/admin'
import { ApiError } from '../../api/http'
import ConfirmDialog from '../ConfirmDialog'
import TimeframeToggle from './TimeframeToggle'
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

export default function AdminUsagePanel({
  userId,
  canReset = true,
}: {
  userId: string
  /** Whether the period's allowances may be handed back (ADMIN-10). False for
   * a deleted account: the endpoint refuses a tombstone, which is restored
   * rather than adjusted, so offering the button would only promise a 404. */
  canReset?: boolean
}) {
  const [timeframe, setTimeframe] = useState<UsageWindow>('period')
  // Bumped by a reset so the meters are re-read rather than left showing the
  // numbers the operator has just cleared.
  const [version, setVersion] = useState(0)
  const key = `${userId}:${timeframe}:${version}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

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

  /** Hands the period's allowances back, then re-reads. Reports what was
   * actually cleared: an account that had spent nothing and one whose
   * counters were wiped both end at zero, and only the "before" tells the
   * operator which just happened. */
  const reset = async () => {
    setConfirming(false)
    setResetting(true)
    setNotice(null)
    setResetError(null)
    try {
      const { cleared } = await resetAdminUserUsage(userId)
      const count = Object.keys(cleared).length
      setNotice(
        count === 0
          ? 'Nothing to reset — every allowance was already at zero for this period.'
          : `Reset ${count} ${count === 1 ? 'allowance' : 'allowances'} for this period.`,
      )
      setVersion(v => v + 1)
    } catch (err) {
      setResetError(
        err instanceof ApiError ? err.message : 'Could not reset allowances.',
      )
    } finally {
      setResetting(false)
    }
  }

  return (
    <section
      data-testid="admin-usage-panel"
      className="mt-8 rounded-lg border border-slate-200 p-4"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-700">Service usage</h2>
        <div className="flex items-center gap-3">
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          {canReset && (
            <button
              type="button"
              disabled={resetting}
              onClick={() => setConfirming(true)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reset allowances
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p role="status" className="mb-2 text-sm text-green-700">
          {notice}
        </p>
      )}
      {resetError && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {resetError}
        </p>
      )}

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

      {/* Neutral rather than red: this gives an allowance back. What it
          cannot undo is the record — the reset is audited, and the counters
          it clears are the only place the spend was still visible. */}
      {confirming && (
        <ConfirmDialog
          title="Reset this account's allowances?"
          message={
            'Every allowance goes back to zero for the current billing period, so the account ' +
            'can spend its caps again before they renew. Stored audio is not reset — it measures ' +
            'what the account is holding right now, not what it spent. Past periods stand, so ' +
            'all-time totals and cost reports still show what was consumed. This is recorded in ' +
            'the audit log.'
          }
          confirmLabel="Reset allowances"
          tone="neutral"
          onConfirm={() => void reset()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}
