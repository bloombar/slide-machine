/**
 * Billing DTOs (SPEC BILL-2) — what the account's Plan view reads, and what
 * checkout and the hosted portal hand back.
 *
 * Provider-neutral by construction (TECH-9): a tier, a status, two dates, and
 * a URL the browser is sent to. No vendor object, price id, or customer
 * reference ever reaches the client, so adopting a different provider changes
 * an adapter rather than this file.
 */
import type { PlanFeature, PlanTier, UsageMetric } from '../types/plans'
import type { UsageAllowance, UsageUnit } from './usage'
import type { PlanPrice, SubscriptionStatus } from '../billing/provider'

/**
 * The account's billing state. `status` is null for an account that has never
 * subscribed — the free tier is an absence of a subscription, not a canceled
 * one, and the two read differently to whoever is looking at the page.
 */
export interface BillingSummary {
  tier: PlanTier
  status: SubscriptionStatus | null
  /** End of the paid period, ISO-8601; null without a subscription. */
  currentPeriodEnd: string | null
  /** The subscription lapses at period end rather than renewing (BILL-5). */
  cancelAtPeriodEnd: boolean
  /**
   * Whether the hosted portal can be opened. False until the provider has
   * issued a customer reference, which first happens at checkout.
   */
  canManageBilling: boolean
  /**
   * Tiers a checkout can be started for — those the deployment has priced
   * (BILL-6). An unpriced tier is not offered rather than failing at the
   * point of purchase.
   */
  purchasableTiers: PlanTier[]
}

/**
 * `returnPath` is an in-app path (`/settings/plan`), never a URL: the value
 * comes back from the provider as a redirect target, and accepting an
 * arbitrary origin would make checkout an open redirect.
 */
export interface BillingCheckoutInput {
  tier: PlanTier
  returnPath?: string
}

export interface BillingPortalInput {
  returnPath?: string
}

/** Which tier to move an existing subscription to (BILL-5). */
export interface PlanChangeInput {
  tier: PlanTier
}

/**
 * One lecture that would lose recordings to a shorter retention window, named
 * so the warning says what is actually at stake rather than a bare count.
 */
export interface PlanChangeLecture {
  deckId: string
  title: string
  /** Recordings on this lecture that fall outside the new window. */
  recordings: number
}

/**
 * What moving to another tier would do, read *before* it is confirmed
 * (BILL-5/P-10). A smaller plan keeps lecture audio for fewer days, which can
 * put recordings the user still has past the new limit — deletion they must be
 * told about while they can still decline it.
 */
export interface PlanChangeImpact {
  /** The tier being moved to, and the one the account is on now. */
  tier: PlanTier
  currentTier: PlanTier
  /** The move is downwards: caps shrink, and audio may be deleted. */
  isDowngrade: boolean
  /**
   * Retention windows, in days, as they actually apply — the shorter of the
   * tier's own and the deployment's. `null` means nothing is deleted on time:
   * either the sweep is off deployment-wide or neither bound applies.
   */
  currentRetentionDays: number | null
  nextRetentionDays: number | null
  /** Recordings that would fall outside the new window, and where they live.
   * `lectures` is capped for readability — `lecturesAffected` is the true
   * count, so a truncated list can say how much it left out. */
  recordingsRemoved: number
  lecturesAffected: number
  lectures: PlanChangeLecture[]
  /**
   * When the new tier starts applying. A paid-to-paid switch is immediate,
   * with the provider prorating it; moving to free cancels, which runs to the
   * end of the period already paid for.
   */
  effective: 'immediately' | 'period_end'
  /** End of the paid period, ISO-8601, when `effective` is `period_end`. */
  effectiveAt: string | null
  /** Whether the change can be made here at all — an account with no
   * subscription has nothing to move, and moves up go through checkout. */
  changeable: boolean
}

/** The account's billing state after a plan change, so the page can show what
 * it is on now without a second read. */
export interface PlanChangeResult {
  summary: BillingSummary
}

/** A hosted page — checkout or portal — for the browser to navigate to. */
export interface BillingRedirect {
  url: string
}

/**
 * One row of the pricing table's metered section: which allowance it draws on
 * and how its numbers read, so the table can format thirteen caps without
 * knowing any metric by name. Ordered the same way the usage panel orders its
 * meters, so a plan's caps and an account's usage are never read in two
 * different sequences.
 */
export interface PlanCapRow {
  metric: UsageMetric
  allowance: UsageAllowance
  unit: UsageUnit
}

/** One plan as the pricing table shows it. */
export interface PlanCatalogEntry {
  tier: PlanTier
  /**
   * A checkout can be started for this tier (BILL-6). False for the free tier
   * by definition, and for a paid tier this deployment has not priced.
   */
  purchasable: boolean
  /**
   * What the provider charges for this tier (BILL-2), or null — the free tier
   * charges nothing, and a paid tier whose price the provider could not state
   * is shown without one rather than with a guess.
   */
  price: PlanPrice | null
  /** Unmetered capabilities the tier includes; every tier includes them all
   * today (BILL-1), and the table ticks what is listed here. */
  features: PlanFeature[]
  /** Allowance per metered resource: null is unlimited, `0` is not offered. */
  caps: Record<UsageMetric, number | null>
  /** Days retained lecture audio is kept; null keeps it indefinitely. */
  audioRetentionDays: number | null
}

/**
 * Every plan side by side (BILL-1/BILL-6) — what the plan-pricing page reads.
 * Config, not account state: it carries no usage, no subscription, and nothing
 * that identifies who asked, so the same answer serves every caller.
 */
export interface PlanCatalog {
  /** Metered rows in display order. */
  metrics: PlanCapRow[]
  /** Plans cheapest-first, in PLAN_TIERS order. */
  plans: PlanCatalogEntry[]
}
