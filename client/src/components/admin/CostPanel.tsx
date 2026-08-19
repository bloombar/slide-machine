/**
 * What one account, project, or lecture cost (SPEC BILL-7).
 *
 * The same panel on all three admin detail pages, because the question is the
 * same one at three scopes and an operator comparing them should not have to
 * re-learn the layout each time.
 *
 * Three things it insists on showing, all of them from the requirement rather
 * than from taste:
 *
 * - **Instructor apart from audience.** The two have different remedies — one
 *   is a plan-sizing question, the other an audience-reach one — so a single
 *   total would hide the only thing the number is useful for.
 * - **How many people, not just how much.** A deck that cost little because
 *   everything was cached still reached its students, and the per-student
 *   average is what says so.
 * - **Registered students only, and it says so.** Anonymous viewers are
 *   counted as events and never as people (§16), so an average over "students"
 *   that quietly excluded them would be a lie by omission.
 */
import { useEffect, useState } from 'react'
import type {
  CostSummaryResponse,
  Money,
  UsageWindow,
} from '@slide-machine/shared'
import { fetchCostSummary, type CostScope } from '../../api/cost'
import TimeframeToggle from './TimeframeToggle'

/** Money for a table cell. Sub-cent figures are common at these scales — a
 * single slide generation costs a fraction of a penny — so a total that
 * rounded to "$0.00" would read as "free" rather than as "very cheap". */
export const formatMoney = (money: Money | null | undefined): string => {
  if (!money) return '—'
  const { amount, micros, currency } = money
  const exact = micros / 1_000_000
  const digits = exact !== 0 && Math.abs(exact) < 0.01 ? 4 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(digits === 2 ? amount : exact)
}

const formatCount = (value: number): string =>
  new Intl.NumberFormat('en-US').format(Math.round(value))

/** Plain-language names, matching the usage panel and the cap emails word for
 * word: an operator and an instructor looking at the same resource should not
 * be reading two different words for it. */
const METRIC_LABELS: Record<string, string> = {
  aiTokens: 'AI generation',
  sttMinutes: 'Audio recording time',
  diarizationMinutes: 'Speaker identification',
  ttsCharacters: 'Narration',
  ttsPremiumCharacters: 'Premium narration',
  aiImages: 'AI images',
  imageLookups: 'Image searches',
  importMb: 'Imports',
  exports: 'Exports',
  translationCharacters: 'Translation',
  audioStorageMb: 'Stored audio',
  audienceTtsCharacters: 'Narration for viewers',
  audienceLocales: 'Translations for viewers',
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-800">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** What has been loaded, tagged with the scope it belongs to. Tagging rather
 * than clearing on scope change: resetting state at the top of an effect
 * cascades a render, and a panel that briefly showed one lecture's cost under
 * another's heading would be worse than a moment of "Loading…". */
interface Loaded {
  key: string
  summary: CostSummaryResponse | null
  failed: boolean
}

/** The scope as the caption names it. */
const NOUNS: Record<CostScope['kind'], string> = {
  user: 'account',
  project: 'project',
  deck: 'lecture',
}

/** In UTC, the calendar the free tier's period rollover follows. */
const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))

/**
 * The one thing every figure below shares, said once — which span of the
 * event ledger is being read. The billing period is the account's own on a
 * user page and the owner's on a project or lecture page (every row here is
 * charged to the owner either way), and it is the same window the Service
 * usage meters cover, so the two panels can finally be compared directly.
 * The all-time caption also says why these numbers are not the allowance
 * counters — the two legitimately disagree, and a reader deserves to know
 * why before suspecting a bug.
 */
const caption = (
  kind: CostScope['kind'],
  timeframe: UsageWindow,
  from?: string | null,
): string => {
  const noun = NOUNS[kind]
  if (timeframe === 'all') {
    return (
      `Everything this ${noun} has ever cost the deployment, from the ` +
      'per-event ledger — cache hits are counted as events at zero cost. ' +
      'Unlike plan allowances, these figures never reset.'
    )
  }
  const since = from ? ` — since ${formatDate(from)}` : ''
  const period =
    kind === 'user'
      ? 'since its allowances last renewed'
      : "during its owner's current billing period"
  return (
    `What this ${noun} has cost the deployment ${period}${since}. ` +
    'Cache hits are counted as events at zero cost.'
  )
}

export default function CostPanel({ scope }: { scope: CostScope }) {
  const [timeframe, setTimeframe] = useState<UsageWindow>('period')
  const key = `${scope.kind}:${scope.id}:${timeframe}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let live = true
    fetchCostSummary(scope, { window: timeframe })
      .then(body => live && setLoaded({ key, summary: body, failed: false }))
      .catch(() => live && setLoaded({ key, summary: null, failed: true }))
    return () => {
      live = false
    }
    // key encodes every input; the eslint rule cannot see through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = loaded?.key === key ? loaded : null
  const summary = current?.summary ?? null
  const failed = current?.failed ?? false
  const nothing =
    summary !== null &&
    summary.total.micros === 0 &&
    !summary.cache.cachedEvents
  const cache = summary?.cache

  return (
    <section
      data-testid="cost-panel"
      className="mt-8 rounded-lg border border-slate-200 p-4"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-700">Cost</h2>
        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {caption(scope.kind, timeframe, summary?.window?.from)}
      </p>

      {failed && (
        <p role="alert" className="text-sm text-red-600">
          Could not load cost.
        </p>
      )}
      {!current && <p className="text-sm text-slate-500">Loading…</p>}

      {summary && cache && nothing && (
        <p className="text-sm text-slate-500">
          {timeframe === 'period'
            ? 'Nothing metered in this billing period.'
            : 'Nothing metered here yet.'}
        </p>
      )}
      {summary && cache && !nothing && (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Total" value={formatMoney(summary.total)} />
            <Figure
              label="Instructor"
              value={formatMoney(summary.instructor)}
              hint="Caused by the owner"
            />
            <Figure
              label="Audience"
              value={formatMoney(summary.audience)}
              hint="Caused by viewers"
            />
            <Figure
              label="Per student"
              value={formatMoney(summary.costPerRegisteredStudent)}
              hint="Registered students only"
            />
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure
              label="Students reached"
              value={formatCount(summary.registeredStudents)}
              hint="With an account"
            />
            <Figure
              label="Anonymous activity"
              value={formatCount(summary.anonymousEvents)}
              hint="Events, not people"
            />
            <Figure
              label="Served from cache"
              value={
                cache.hitRatio === null
                  ? '—'
                  : `${Math.round(cache.hitRatio * 100)}%`
              }
              hint={`${formatCount(cache.cachedEvents)} of ${formatCount(
                cache.billableEvents + cache.cachedEvents,
              )} events`}
            />
            <Figure
              label="Cost avoided"
              value={formatMoney(cache.estimatedAvoided)}
              hint="Estimated, by caching"
            />
          </dl>

          {summary.system.micros > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {formatMoney(summary.system)} of the total was caused by the
              system rather than by a person — background jobs and backfills.
            </p>
          )}

          {summary.byMetric.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2">
                      Service
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Used
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Events
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byMetric.map(row => (
                    <tr key={row.metric} className="border-t border-slate-100">
                      <td className="py-2">
                        {METRIC_LABELS[row.metric] ?? row.metric}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCount(row.quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCount(row.events)}
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
    </section>
  )
}
