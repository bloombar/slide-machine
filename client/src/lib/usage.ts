/**
 * Presentation rules for metered usage (SPEC BILL-4). Pure functions, kept
 * out of the components so the decisions that matter — what counts as "close
 * to a limit", which call to action a tier gets — are testable without a DOM
 * and identical wherever usage is shown.
 */
import {
  USAGE_WARN_THRESHOLD,
  type PlanTier,
  type UsageMetricSummary,
  type UsageUnit,
} from '@slide-machine/shared'
import { formatNumber } from '../i18n/format'

/**
 * Metrics worth surfacing unprompted: at or past the warning threshold, worst
 * first. Unlimited metrics have no fraction and so can never qualify — there
 * is nothing to run out of.
 *
 * The same threshold BILL-8 emails on, so the app never warns about something
 * it is not also showing, or the reverse.
 */
export const approachingLimits = (
  metrics: UsageMetricSummary[],
): UsageMetricSummary[] =>
  metrics
    .filter(m => m.fraction !== null && m.fraction >= USAGE_WARN_THRESHOLD)
    .sort((a, b) => (b.fraction ?? 0) - (a.fraction ?? 0))

/** Whether a metric has no allowance left. Distinct from "approaching": one
 * is a warning, the other is why something just refused to happen. */
export const isExhausted = (m: UsageMetricSummary): boolean =>
  m.fraction !== null && m.fraction >= 1

/**
 * Which call to action a tier gets (BILL-4/BILL-5). Max has no larger plan to
 * move to, so offering an upgrade would send the user looking for a page that
 * cannot exist; they are invited to get in touch instead.
 */
export const callToActionFor = (tier: PlanTier): 'upgrade' | 'contact' =>
  tier === 'max' ? 'contact' : 'upgrade'

/** i18n key for a unit's suffix, or null when the metric's own label already
 * says what is being counted ("Narration — 12,000 of 60,000"). */
const UNIT_KEY: Partial<Record<UsageUnit, string>> = {
  minutes: 'usage.unit.minutes',
  mb: 'usage.unit.mb',
}

/**
 * Formats an amount for display, rounding to whole units — a quota is read at
 * a glance, and "1,920.37 MB" is no more useful than "1,920".
 *
 * `translate` is passed in rather than imported so this stays a pure function
 * and the caller supplies the hook's `t` it already has.
 */
export const formatAmount = (
  value: number,
  unit: UsageUnit,
  translate: (key: string, vars: Record<string, unknown>) => string,
): string => {
  const number = formatNumber(Math.round(value))
  const key = UNIT_KEY[unit]
  return key ? translate(key, { value: number }) : number
}
