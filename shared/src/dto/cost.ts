/**
 * Cost-reporting DTOs (SPEC BILL-7) — what the admin console reads about what
 * the deployment spends and on whom.
 *
 * Money crosses the wire as **both** exact micros and a rounded amount. The
 * micros are the truth the ledger stores and the only safe thing to sum; the
 * amount is what a table prints. Sending only the rounded figure would make
 * every client re-derive totals from rounded parts, and sending only micros
 * would make every client know the scale.
 */
import type { UsageMetric } from '../types/plans'

export interface Money {
  /** Millionths of a currency unit — exact, and the only field to sum. */
  micros: number
  /** The same figure in currency units, rounded to cents, for display. */
  amount: number
  currency: string
}

export interface CostByMetric {
  metric: UsageMetric
  quantity: number
  cost: Money
  /** Billable and cached events alike — how often it happened at all. */
  events: number
}

/** Whether caching is earning its complexity (BILL-7). */
export interface CacheEfficiency {
  billableEvents: number
  cachedEvents: number
  /** Cached ÷ all, 0–1; null before anything has happened. */
  hitRatio: number | null
  /**
   * What the cached work would have cost if it had been paid for, priced per
   * metric at the rate that metric actually billed at. An estimate by
   * necessity — a cache hit really did cost nothing, so the counterfactual has
   * to be reconstructed — and named as one wherever it is shown.
   */
  estimatedAvoided: Money
}

/** What one account, project, or lecture cost. */
export interface CostSummaryResponse {
  total: Money
  /** Spend the payer caused themselves. */
  instructor: Money
  /** Spend their viewers caused, charged to them. */
  audience: Money
  /** Work the deployment caused on nobody's behalf. */
  system: Money
  byMetric: CostByMetric[]
  /**
   * Students with accounts who caused activity. Anonymous viewers are not in
   * this number and cannot be: they have no identity to count, and creating
   * one to make them countable would conflict with §16.
   */
  registeredStudents: number
  /** Activity from viewers with no account, as an event count. */
  anonymousEvents: number
  /** Audience spend ÷ registered students; null when there are none. Scoped to
   * registered students, and every view that prints it says so. */
  costPerRegisteredStudent: Money | null
  cache: CacheEfficiency
}

export interface TopSpender {
  payerId: string
  email?: string
  displayName?: string
  cost: Money
}

/** The deployment-wide view. */
export interface CostOverviewResponse {
  window: { from: string | null; to: string | null }
  totals: CostSummaryResponse
  activeUsers: number
  activeStudents: number
  lecturesWithSpend: number
  projectsWithSpend: number
  /**
   * Per *active* entity, never per existing one: an account that spent nothing
   * is not a cheap user, and dividing by dormant accounts would make a
   * deployment look cheaper the more of them it accumulates.
   */
  averages: {
    perUser: Money | null
    perLecture: Money | null
    perProject: Money | null
    perRegisteredStudent: Money | null
  }
  topSpenders: TopSpender[]
}
