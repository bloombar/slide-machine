/**
 * The account's own view of its usage (SPEC BILL-4).
 *
 * BILL-3 counts; this presents. It sits beside the counters rather than inside
 * them because the two answer different questions: `usage.ts` has to be cheap
 * enough to run on every metered call, while this runs when someone opens a
 * page and can afford to sort, group, and look up a reset date.
 *
 * Nothing here decides policy. The caps come from the plan config, the counts
 * from the counters, and the ordering exists only so the interface does not
 * have to know thirteen metric names to lay them out sensibly.
 */
import {
  AUDIENCE_METRICS,
  type PlanTier,
  type UsageAllowance,
  type UsageMetric,
  type UsageMetricSummary,
  type UsageSummaryResponse,
  type UsageUnit,
} from '@slide-machine/shared'
import { isGaugeMetric, periodResetAt, usageSummary } from './usage'

/**
 * How each metric's number reads. Kept here rather than in the bundle so a
 * translator picks the words for a *unit*, not for thirteen separate metrics,
 * and so a new metric without an entry still renders as a plain count instead
 * of crashing the page.
 */
const UNITS: Partial<Record<UsageMetric, UsageUnit>> = {
  aiTokens: 'tokens',
  sttMinutes: 'minutes',
  diarizationMinutes: 'minutes',
  ttsCharacters: 'characters',
  ttsPremiumCharacters: 'characters',
  translationCharacters: 'characters',
  audienceTtsCharacters: 'characters',
  importMb: 'mb',
  audioStorageMb: 'mb',
}

/**
 * Display order: the services a user is most likely to run out of first, then
 * the rest. Metrics absent from this list still appear — they sort to the end
 * — so adding a cap can never make it invisible.
 */
const ORDER: readonly UsageMetric[] = [
  'sttMinutes',
  'aiTokens',
  'ttsCharacters',
  'ttsPremiumCharacters',
  'diarizationMinutes',
  'translationCharacters',
  'aiImages',
  'imageLookups',
  'audioStorageMb',
  'importMb',
  'exports',
  'audienceTtsCharacters',
  'audienceLocales',
]

const allowanceOf = (metric: UsageMetric): UsageAllowance =>
  AUDIENCE_METRICS.includes(metric) ? 'audience' : 'instructor'

/**
 * How much of a cap is spent, 0–1. Null when unlimited — there is no fraction
 * of an unbounded allowance — and clamped at 1 so a metric that overshot by
 * the one call BILL-3 tolerates does not render as 103% of a bar.
 */
const fractionOf = (used: number, cap: number | null): number | null => {
  if (cap === null) return null
  if (cap <= 0) return 1 // not offered on this tier: nothing left to spend
  return Math.min(1, used / cap)
}

/** Instructor allowances first, then audience; within each, `ORDER`. */
const sortKey = (m: UsageMetricSummary): [number, number] => [
  m.allowance === 'audience' ? 1 : 0,
  ORDER.indexOf(m.metric) === -1 ? ORDER.length : ORDER.indexOf(m.metric),
]

/** Every metered resource for one user, ready for the account and home views. */
export const accountUsage = async (
  userId: string,
  tier: PlanTier,
): Promise<UsageSummaryResponse> => {
  const [summary, resetAt] = await Promise.all([
    usageSummary(userId, tier),
    periodResetAt(userId),
  ])

  const metrics = Object.entries(summary.metrics)
    .map(([key, { used, cap }]): UsageMetricSummary => {
      const metric = key as UsageMetric
      return {
        metric,
        used,
        cap,
        fraction: fractionOf(used, cap),
        allowance: allowanceOf(metric),
        unit: UNITS[metric] ?? 'count',
        gauge: isGaugeMetric(metric),
      }
    })
    .sort((a, b) => {
      const [aGroup, aIndex] = sortKey(a)
      const [bGroup, bIndex] = sortKey(b)
      return aGroup - bGroup || aIndex - bIndex
    })

  return {
    tier,
    period: summary.period,
    resetAt: resetAt.toISOString(),
    metrics,
  }
}
