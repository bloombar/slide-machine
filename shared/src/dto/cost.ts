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
   * Signed-in accounts that caused activity as audience — derived from the
   * role recorded on each ledger row, never from asking anyone what they are.
   * Anonymous viewers are not in this number and cannot be: they have no
   * identity to count, and creating one to make them countable would conflict
   * with §16.
   */
  registeredViewers: number
  /** Activity from viewers with no account, as an event count. */
  anonymousEvents: number
  /** Audience spend ÷ registered viewers; null when there are none. Scoped to
   * registered viewers, and every view that prints it says so. */
  costPerRegisteredViewer: Money | null
  cache: CacheEfficiency
  /**
   * The span the figures cover, as the route resolved it — for
   * `?window=period`, the payer's current billing period. Open ends are null;
   * absent on responses older than this field.
   */
  window?: { from: string | null; to: string | null }
}

/**
 * One per-unit vendor rate the deployment's current configuration can
 * actually incur. Filtered server-side: an entry for a provider that is
 * switched off, or a model nothing is configured to call, is not in the list.
 */
export interface ConfiguredPrice {
  /** Plain-language service name, e.g. 'AI generation'. */
  service: string
  /** Which configured entry the rate is for: a model, voice family, or mode. */
  detail?: string
  /** What one unit is, e.g. 'per 1M input tokens'. */
  unit: string
  /** The per-unit rate — in `currency` units, or a fraction for `percent`. */
  rate: number
  /** How to print the rate. */
  kind: 'currency' | 'percent'
  /** What the bare rate would misstate, e.g. a free monthly allowance. */
  note?: string
}

/**
 * The per-unit vendor prices behind the deployment's current configuration
 * (`config/service-prices.json`), rebuilt from the config on every request so
 * a rate edit shows up on the next refresh.
 */
export interface ServicePricesResponse {
  /** When the figures were last verified against the vendors' pricing. */
  asOf: string
  currency: string
  /** In configuration order, grouped by service. */
  prices: ConfiguredPrice[]
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
  activeViewers: number
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
    perRegisteredViewer: Money | null
  }
  topSpenders: TopSpender[]
}
