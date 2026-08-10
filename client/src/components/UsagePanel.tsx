/**
 * The full usage breakdown in account settings (SPEC BILL-4): every metered
 * resource with used-versus-cap, when the period resets, and the instructor
 * and audience allowances shown apart.
 *
 * Storage sits with the instructor metrics but carries no reset date — it is a
 * stock, and retained audio does not disappear because a month rolled over.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { fetchUsage, setCapWarnings } from '../api/usage'
import { useAuth } from '../auth/AuthContext'
import { formatDate } from '../i18n/format'
import UsageCallToAction from './UsageCallToAction'
import UsageMeterGroups from './UsageMeterGroups'

export default function UsagePanel() {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetchUsage()
      .then(body => live && setUsage(body))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  if (failed) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t('usage.errors.load')}
      </p>
    )
  }
  if (!usage) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  return (
    <section data-testid="usage-panel" className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-medium text-slate-700">
          {t('usage.title')}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {t('usage.resets', { date: formatDate(usage.resetAt, 'long') })}
        </p>
      </div>

      <UsageMeterGroups metrics={usage.metrics} />

      <CapWarningToggle />

      <p className="text-xs text-slate-500">
        {/* No plan link: this panel *is* the Plan tab, so it would point at
            itself. */}
        <UsageCallToAction tier={usage.tier} />
      </p>
    </section>
  )
}

/**
 * The one switch BILL-8 offers: whether the 80% heads-up arrives by email.
 *
 * Only the advisory message is switchable, and the hint says so rather than
 * leaving the user to discover it. The exhaustion notice explains why
 * something they just attempted did not happen — turning that off would
 * recreate the failure this whole requirement exists to prevent — and the
 * in-app notices are derived from the counters and always appear.
 */
function CapWarningToggle() {
  const { t } = useTranslation()
  const { user, updateUser } = useAuth()
  const [saving, setSaving] = useState(false)
  if (!user) return null

  const toggle = async (enabled: boolean): Promise<void> => {
    setSaving(true)
    try {
      updateUser(await setCapWarnings(enabled))
    } catch {
      // Left as it was. A preference that failed to save is a smaller problem
      // than a settings page that throws, and the next attempt is one click
      // away.
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={user.notifyCapWarnings !== false}
        disabled={saving}
        onChange={e => void toggle(e.target.checked)}
      />
      <span>
        {t('usage.settings.warnEmails')}
        <span className="mt-0.5 block text-xs text-slate-500">
          {t('usage.settings.warnEmailsHint')}
        </span>
      </span>
    </label>
  )
}
