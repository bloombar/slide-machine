/**
 * BillingProvider — the vendor-neutral seam for payments (SPEC TECH-9), the
 * billing counterpart to the AI provider interfaces (TECH-8). Application and
 * UI logic deal only in the concepts declared here — tier, subscription
 * status, and opaque customer/subscription references. Vendor objects, API
 * shapes, and webhook formats stay inside the adapter, so adopting a
 * different provider is a new adapter plus a data backfill, never an
 * application rewrite.
 */
import type { PlanTier } from '../types/plans'

/** Subscription lifecycle states the application understands (BILL-2). */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled'] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Internal billing events that provider webhooks are normalized into. */
export const BILLING_EVENT_TYPES = [
  'subscription.active',
  'subscription.past_due',
  'subscription.canceled',
] as const

export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number]

/**
 * Provider-neutral view of one subscription. The two ids are opaque strings
 * scoped to the provider that issued them — nothing outside the adapter may
 * parse or construct them.
 */
export interface SubscriptionSnapshot {
  providerSubscriptionId: string
  billingCustomerId: string
  /**
   * The account this subscription belongs to, when the provider can tell us.
   * Adapters read it back out of whatever metadata they were given at
   * checkout, so a webhook arriving before any local record exists can still
   * be attributed. Optional because a provider may not echo it — callers fall
   * back to matching on the opaque references.
   */
  userId?: string
  tier: PlanTier
  status: SubscriptionStatus
  /** ISO-8601 timestamps bounding the current billing period. */
  currentPeriodStart: string
  currentPeriodEnd: string
  /** True when the subscription lapses at period end instead of renewing. */
  cancelAtPeriodEnd: boolean
}

/** A provider webhook after verification and normalization. */
export interface BillingEvent {
  type: BillingEventType
  /** The provider's own event id, so callers can apply each event once. */
  providerEventId: string
  occurredAt: string
  subscription: SubscriptionSnapshot
}

/**
 * What one plan costs, as the provider quotes it (BILL-2/BILL-6). The provider
 * is the system of record for money, so this is read from it rather than
 * duplicated into our own config, where the two could quietly disagree and the
 * page would advertise a price the checkout does not charge.
 *
 * The amount is in the currency's **minor unit** — 2900 is $29.00 — because
 * that is how providers quote money and the only representation that cannot
 * lose a fraction on the way through. Formatting for a reader, including how
 * many minor units make a major one, is the interface's job.
 */
export interface PlanPrice {
  amountMinor: number
  /** ISO-4217 code, as the provider gives it (e.g. "usd"). */
  currency: string
  /** The period one charge covers. */
  interval: 'day' | 'week' | 'month' | 'year'
  /** Intervals per charge — 3 for a price billed quarterly. Usually 1. */
  intervalCount: number
}

export interface CheckoutRequest {
  /** Threaded through to the provider so its webhooks identify the account. */
  userId: string
  email: string
  tier: PlanTier
  successUrl: string
  cancelUrl: string
  /** Existing customer reference, when the user has been billed before. */
  billingCustomerId?: string
}

export interface CheckoutSession {
  /** Hosted checkout page the browser is sent to. */
  url: string
  providerSessionId: string
}

export interface PortalRequest {
  billingCustomerId: string
  returnUrl: string
}

export interface PortalSession {
  /** Hosted customer/billing portal page the browser is sent to. */
  url: string
}

export interface TierChangeRequest {
  providerSubscriptionId: string
  tier: PlanTier
}

export interface CancelRequest {
  providerSubscriptionId: string
  /** Cancel at the end of the paid period (default) rather than immediately. */
  atPeriodEnd?: boolean
}

/**
 * A webhook exactly as received. Signature schemes sign the raw bytes, so the
 * body is handed over unparsed and the adapter verifies it before trusting it.
 */
export interface WebhookDelivery {
  rawBody: string
  headers: Record<string, string | undefined>
}

export interface BillingProvider {
  readonly name: string
  /** Starts a hosted checkout for a new subscription at `tier`. */
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>
  /**
   * What the given prices cost, keyed by the price id asked for. Ids the
   * provider does not recognize are **left out** rather than raising: a
   * pricing table missing one figure is better than a page that will not load,
   * and a caller can tell the difference from the absent key.
   */
  listPrices(priceIds: string[]): Promise<Record<string, PlanPrice>>
  /** Moves an existing subscription to another tier (up or down). */
  changeTier(request: TierChangeRequest): Promise<SubscriptionSnapshot>
  /** Opens the hosted portal for payment methods, invoices, cancellation. */
  createPortalSession(request: PortalRequest): Promise<PortalSession>
  cancelSubscription(request: CancelRequest): Promise<SubscriptionSnapshot>
  /**
   * Verifies a delivery and normalizes it into an internal event. Resolves to
   * null for events the application does not act on; throws when verification
   * fails, so an unverified payload can never be mistaken for an ignored one.
   */
  parseWebhook(delivery: WebhookDelivery): Promise<BillingEvent | null>
}
