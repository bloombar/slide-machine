/**
 * Account usage DTO (SPEC BILL-4, "usage is visible before it binds").
 *
 * The server already counts every metered service (BILL-3); this is the shape
 * that lets a user see it before a cap refuses them something. Two views read
 * it: a short one on the home page listing only what is close to a limit, and
 * a full one in account settings listing every metric with its cap and the
 * date the period resets.
 */
import type { PlanTier, UsageMetric } from '../types/plans'

/**
 * Fraction of a cap at which a metric counts as "approaching" — the point the
 * home page starts mentioning it, and the same threshold BILL-8 notifies on.
 * One constant so a user cannot be warned by email about a metric the app is
 * not yet showing them, or the reverse.
 */
export const USAGE_WARN_THRESHOLD = 0.8

/**
 * Which allowance a metric draws on. Audience metrics are spent by *viewers*
 * of a deck and charged to its owner from a separate pool, so a widely-watched
 * lecture can never exhaust its author's own budget (BILL-3) — which only
 * works as an explanation if the two are also shown apart (BILL-4).
 */
export type UsageAllowance = 'instructor' | 'audience'

/** The metrics viewers spend; everything else is the instructor's own. */
export const AUDIENCE_METRICS: readonly UsageMetric[] = [
  'audienceTtsCharacters',
  'audienceLocales',
]

/** How a metric's number should be read, so the interface can format it
 * without knowing each metric by name. */
export type UsageUnit = 'count' | 'minutes' | 'characters' | 'tokens' | 'mb'

/** One metered resource, as the account and home views show it. */
export interface UsageMetricSummary {
  metric: UsageMetric
  /** Spent this period — or, for a gauge, held right now. */
  used: number
  /** null = unlimited. `0` = not offered on this tier (no shipped tier does). */
  cap: number | null
  /** `used / cap`, clamped to 1; null when the cap is unlimited, so callers
   * never divide by a missing bound. */
  fraction: number | null
  allowance: UsageAllowance
  unit: UsageUnit
  /**
   * A stock rather than a per-period flow (`audioStorageMb`). The period reset
   * does not apply to it, and saying otherwise would be untrue — retained audio
   * does not disappear because a month rolled over.
   */
  gauge: boolean
}

/** Everything the usage views need in one response. */
export interface UsageSummaryResponse {
  tier: PlanTier
  /** Opaque period key the flow counters live under (BILL-3). */
  period: string
  /**
   * When the flow counters next reset, ISO-8601. A subscriber's billing period
   * end; otherwise the start of the next calendar month, UTC — the free tier
   * has no subscription to key to.
   */
  resetAt: string
  /** Every metered resource, instructor allowances first. */
  metrics: UsageMetricSummary[]
}
