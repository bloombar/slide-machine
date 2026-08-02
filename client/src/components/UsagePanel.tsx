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
import { fetchUsage } from '../api/usage'
import { formatDate } from '../i18n/format'
import { callToActionFor } from '../lib/usage'
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

      <p className="text-xs text-slate-500">
        {t(`usage.cta.${callToActionFor(usage.tier)}`)}
      </p>
    </section>
  )
}
