/**
 * The home page's short usage view (SPEC BILL-4/BILL-8): only the metrics that
 * are actually close to a limit, and nothing at all when none are.
 *
 * Silence is the point. A dashboard that always shows thirteen bars trains
 * people to stop reading it, and then the one time a number matters they miss
 * it. This appears when it has something to say and is otherwise absent.
 *
 * The two states are not the same kind of thing, and BILL-8 asks them to
 * behave differently:
 *
 *  - **Approaching** is advice. It can be dismissed, because a user who has
 *    seen it and decided to carry on should not be nagged for the rest of the
 *    month.
 *  - **Reached** is a standing condition — something is refusing to run right
 *    now — so it has no dismiss control at all. It goes away when the fact
 *    goes away: the period resets, the plan changes, or usage is freed.
 *
 * Nothing here depends on the notification emails having been sent. The
 * in-app state is derived from the counters, so a deployment with no mail
 * configured still warns its users, and a user who silenced the advisory email
 * still sees this.
 *
 * It never blocks the page: a usage read that fails renders nothing rather
 * than an error, because the home page's job is to list lectures and a
 * billing sidebar failing is not worth interrupting that.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import type {
  UsageMetricSummary,
  UsageSummaryResponse,
} from '@slide-machine/shared'
import { fetchUsage } from '../api/usage'
import { approachingLimits, callToActionFor, isExhausted } from '../lib/usage'
import UsageMeter from './UsageMeter'

const STORAGE_PREFIX = 'sm:usage-notice-dismissed:'

/**
 * What a dismissal applies to: this billing period, and this exact set of
 * metrics.
 *
 * Both halves matter. Keying on the period brings the notice back when the
 * allowances reset, so a dismissal cannot outlive the situation it was about.
 * Keying on the metrics brings it back when a *different* resource starts
 * running out — "I have seen the narration warning" is not consent to be kept
 * quiet about recording time.
 */
const dismissKey = (period: string, metrics: UsageMetricSummary[]): string =>
  `${STORAGE_PREFIX}${period}:${metrics
    .map(m => m.metric)
    .sort()
    .join(',')}`

const wasDismissed = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // Storage blocked. The notice simply reappears on reload, which is the
    // safe direction to fail in for something that exists to be seen.
    return false
  }
}

export default function UsageNotice() {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchUsage()
      .then(body => live && setUsage(body))
      .catch(() => {}) // never interrupts the lecture list
    return () => {
      live = false
    }
  }, [])

  if (!usage) return null
  const close = approachingLimits(usage.metrics)
  if (!close.length) return null

  // "Reached" is a standing condition, not an event, so it reads louder than
  // the advisory "approaching" — and cannot be dismissed (BILL-8).
  const blocked = close.some(isExhausted)
  const key = dismissKey(usage.period, close)
  if (!blocked && (dismissedKey === key || wasDismissed(key))) return null

  const dismiss = (): void => {
    setDismissedKey(key)
    try {
      localStorage.setItem(key, '1')
    } catch {
      // See wasDismissed: the dismissal holds for this render either way.
    }
  }

  return (
    <section
      data-testid="usage-notice"
      className={`mb-6 rounded-md border p-4 ${
        blocked ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <AlertTriangle
          className={`h-4 w-4 ${blocked ? 'text-red-500' : 'text-amber-500'}`}
          aria-hidden
        />
        {t(blocked ? 'usage.notice.reached' : 'usage.notice.approaching')}
        {!blocked && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('usage.notice.dismiss')}
            className="ml-auto rounded p-1 text-slate-500 hover:bg-amber-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </h2>

      <div className="mt-3 flex flex-col gap-3">
        {close.map(m => (
          <UsageMeter key={m.metric} metric={m} />
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-600">
        {/* The message carries a <planLink> slot for the footer badge, whose
            popover has no other way to the Plan tab. Here it renders as plain
            text: the notice already links there on the next line, and two
            links to one destination in one sentence is a coin toss for the
            reader rather than a choice. */}
        <Trans
          i18nKey={`usage.cta.${callToActionFor(usage.tier)}`}
          components={{ planLink: <span /> }}
        />{' '}
        {/* The Plan tab is where the full set of meters lives, next to the
            plan this notice is asking about changing. */}
        <Link
          to="/app/settings?tab=plan"
          className="font-medium text-indigo-700 hover:underline"
        >
          {t('usage.notice.seeAll')}
        </Link>
      </p>
    </section>
  )
}
