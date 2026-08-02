/**
 * Every metered resource, split into the instructor's own allowances and the
 * ones their audience spends (SPEC BILL-4). Shared by the account-settings
 * panel and the footer badge so the same numbers are grouped the same way
 * wherever they are read.
 *
 * The split is not cosmetic: a deck's viewers spend the owner's money from a
 * separate pool, so a lecture that finds an audience can never stop its author
 * preparing tomorrow's (BILL-3). Shown as one flat list, that protection would
 * look like an accounting quirk.
 */
import { useTranslation } from 'react-i18next'
import type { UsageMetricSummary } from '@slide-machine/shared'
import UsageMeter from './UsageMeter'

/** One titled block. Rendered only when it has rows, so a configuration with
 * no audience allowances shows no empty heading. */
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
        <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {title}
        </h4>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {metrics.map(m => (
        <UsageMeter key={m.metric} metric={m} />
      ))}
    </div>
  )
}

export default function UsageMeterGroups({
  metrics,
  /** Drops the audience group's explanatory line where space is tight. */
  compact = false,
}: {
  metrics: UsageMetricSummary[]
  compact?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5">
      <MeterGroup
        title={t('usage.instructor')}
        metrics={metrics.filter(m => m.allowance === 'instructor')}
      />
      <MeterGroup
        title={t('usage.audience')}
        hint={compact ? undefined : t('usage.audienceHint')}
        metrics={metrics.filter(m => m.allowance === 'audience')}
      />
    </div>
  )
}
