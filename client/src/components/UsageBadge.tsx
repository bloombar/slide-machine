/**
 * Plan-usage status in the sticky footer, beside the API health badge
 * (SPEC BILL-4, "usage is visible before it binds"). Collapsed, it shows how
 * the account stands overall ("Usage ok"). Clicked, it expands into a panel
 * breaking that down by capped service, with the period reset date.
 *
 * Deliberately mirrors HealthBadge's shape — dot, summary, click-to-expand,
 * dismiss on outside click or Escape — because the two sit next to each other
 * and reading one should teach you how to read the other. What differs is
 * whose fact it reports: health is the deployment's, this is the account's, so
 * it renders nothing at all for a signed-out visitor. A stranger on a shared
 * lecture must never see the instructor's billing state (BILL-4).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { fetchUsage } from '../api/usage'
import { useAuth } from '../auth/AuthContext'
import { formatDate } from '../i18n/format'
import { approachingLimits, callToActionFor, isExhausted } from '../lib/usage'
import UsageMeterGroups from './UsageMeterGroups'

/** Overall standing, worst-metric-wins. */
type UsageStatus = 'ok' | 'approaching' | 'reached' | 'loading' | 'error'

/** Dot colour per status; the summary text says the same thing, so colour is
 * never the only signal (TECH-11). */
const dotStyles: Record<UsageStatus, string> = {
  ok: 'bg-green-500',
  approaching: 'bg-yellow-500',
  reached: 'bg-red-500',
  loading: 'bg-slate-300',
  error: 'bg-slate-300',
}

/** The worst state any capped service is in. */
const statusOf = (usage: UsageSummaryResponse): UsageStatus => {
  const close = approachingLimits(usage.metrics)
  if (close.some(isExhausted)) return 'reached'
  return close.length ? 'approaching' : 'ok'
}

export default function UsageBadge() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    if (!user) return
    fetchUsage()
      .then(body => {
        setUsage(body)
        setError(false)
      })
      .catch(() => setError(true))
  }, [user])

  useEffect(load, [load])

  // While the panel is open, a click anywhere outside it — or Escape —
  // dismisses it, like any lightweight popover.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Re-read when the user opens the panel: a lecture they just gave may have
  // moved several of these since the page loaded.
  const toggle = () => {
    setOpen(prev => {
      if (!prev) load()
      return !prev
    })
  }

  // Usage is an account's own business; a signed-out visitor has none to show.
  if (!user) return null

  const status: UsageStatus = error
    ? 'error'
    : usage
      ? statusOf(usage)
      : 'loading'
  const statusLabel = t(`usage.badge.state.${status}`)

  return (
    <div
      ref={containerRef}
      role="status"
      data-testid="usage-bar"
      className="relative flex items-center"
    >
      {open && usage && (
        <div
          data-testid="usage-panel-popover"
          className="absolute bottom-full left-1/2 z-40 mb-2 max-h-[70vh] w-80 -translate-x-1/2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          {/* The plan is the context every number below it depends on: the
              same 30 minutes is comfortable on Pro and nearly spent on Free. */}
          <p className="flex items-center gap-2 text-xs text-slate-600">
            <span>{t('usage.plan')}</span>
            <span
              data-testid="usage-plan"
              className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700"
            >
              {t(`plan.tier.${usage.tier}`, { defaultValue: usage.tier })}
            </span>
          </p>
          <p className="mt-1 mb-3 text-xs text-slate-500">
            {t('usage.resets', { date: formatDate(usage.resetAt, 'long') })}
          </p>
          <UsageMeterGroups metrics={usage.metrics} compact />
          <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
            {t(`usage.cta.${callToActionFor(usage.tier)}`)}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        disabled={!usage}
        title={statusLabel}
        className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-500 hover:text-slate-700 disabled:hover:text-slate-500"
      >
        <span
          className={`h-2 w-2 rounded-full ${dotStyles[status]}`}
          aria-hidden
        />
        {/* Plan and standing together: "ok" answers a different question
            depending on which plan it is ok for. Saying both in text also
            keeps colour from being the only signal (TECH-11). */}
        <span>
          {t('usage.badge.summary', {
            plan: t(`plan.tier.${usage?.tier ?? user.planTier}`, {
              defaultValue: usage?.tier ?? user.planTier,
            }),
            status: statusLabel,
          })}
        </span>
      </button>
    </div>
  )
}
