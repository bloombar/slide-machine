/**
 * Billing DTOs (SPEC BILL-2) — what the account's Plan view reads, and what
 * checkout and the hosted portal hand back.
 *
 * Provider-neutral by construction (TECH-9): a tier, a status, two dates, and
 * a URL the browser is sent to. No vendor object, price id, or customer
 * reference ever reaches the client, so adopting a different provider changes
 * an adapter rather than this file.
 */
import type { PlanTier } from '../types/plans'
import type { SubscriptionStatus } from '../billing/provider'

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
