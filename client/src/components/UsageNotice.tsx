/**
 * The home page's short usage view (SPEC BILL-4): only the metrics that are
 * actually close to a limit, and nothing at all when none are.
 *
 * Silence is the point. A dashboard that always shows thirteen bars trains
 * people to stop reading it, and then the one time a number matters they miss
 * it. This appears when it has something to say and is otherwise absent.
 *
 * It never blocks the page: a usage read that fails renders nothing rather
 * than an error, because the home page's job is to list lectures and a
 * billing sidebar failing is not worth interrupting that.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { fetchUsage } from '../api/usage'
import { useAuth } from '../auth/AuthContext'
import { approachingLimits, callToActionFor, isExhausted } from '../lib/usage'
import UsageMeter from './UsageMeter'

export default function UsageNotice() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null)

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
  // the advisory "approaching" (BILL-8's in-app rule, applied here too).
  const blocked = close.some(isExhausted)

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
      </h2>

      <div className="mt-3 flex flex-col gap-3">
        {close.map(m => (
          <UsageMeter key={m.metric} metric={m} />
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-600">
        {t(`usage.cta.${callToActionFor(usage.tier)}`)}{' '}
        {user && (
          <Link
            to={`/app/u/${user.id}`}
            className="font-medium text-indigo-700 hover:underline"
          >
            {t('usage.notice.seeAll')}
          </Link>
        )}
      </p>
    </section>
  )
}
