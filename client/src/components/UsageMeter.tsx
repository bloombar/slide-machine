/**
 * One metered resource as a labelled bar (SPEC BILL-4). Shared by the account
 * panel and the home-page notice so a metric reads identically wherever it
 * appears.
 *
 * The metric is named in plain language — "Narration", "Recording time" — not
 * by its identifier: the person reading has a lecture to give, and `ttsCharacters`
 * is a fact about our database, not about their afternoon.
 */
import { useTranslation } from 'react-i18next'
import type { UsageMetricSummary } from '@slide-machine/shared'
import { formatAmount, isExhausted } from '../lib/usage'

/** Bar colour by how close the metric is to its limit. Colour is never the
 * only signal — the numbers beside it say the same thing — so this stays
 * legible to a colour-blind reader (TECH-11). */
const barColor = (fraction: number): string => {
  if (fraction >= 1) return 'bg-red-500'
  if (fraction >= 0.8) return 'bg-amber-500'
  return 'bg-indigo-500'
}

export default function UsageMeter({ metric }: { metric: UsageMetricSummary }) {
  const { t } = useTranslation()
  const label = t(`usage.metric.${metric.metric}`, {
    defaultValue: metric.metric,
  })
  const used = formatAmount(metric.used, metric.unit, t)

  // An unlimited cap has no bar to draw: there is no proportion of unbounded.
  const amount =
    metric.cap === null
      ? t('usage.usedUnlimited', { used })
      : t('usage.usedOfCap', {
          used,
          cap: formatAmount(metric.cap, metric.unit, t),
        })

  return (
    <div
      data-testid={`usage-metric-${metric.metric}`}
      className="flex flex-col gap-1"
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-700">{label}</span>
        <span
          className={
            isExhausted(metric)
              ? 'font-medium text-red-600'
              : 'text-slate-500 tabular-nums'
          }
        >
          {amount}
        </span>
      </div>
      {metric.fraction !== null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(metric.fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full ${barColor(metric.fraction)}`}
            style={{ width: `${Math.max(2, metric.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
