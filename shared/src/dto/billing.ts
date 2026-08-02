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
