/**
 * Deterministic mock BillingProvider (BILLING_PROVIDER=mock) — runs the whole
 * checkout → portal → webhook path without a payment vendor or network, so
 * dev, tests, and e2e exercise real application logic against fake billing.
 * Subscriptions live in memory; ids are sequential rather than random so
 * assertions can name them.
 */
import type {
  BillingEvent,
  BillingEventType,
  BillingProvider,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  PlanTier,
  PortalRequest,
  PortalSession,
  SubscriptionSnapshot,
  TierChangeRequest,
  WebhookDelivery,
} from '@slide-machine/shared'
import { BILLING_EVENT_TYPES } from '@slide-machine/shared'
import { billingRegistry } from './registry'
import { WebhookVerificationError } from './errors'

/** Length of a mock billing period. */
const PERIOD_DAYS = 30

/** Tier assumed when a request names a subscription the mock never issued. */
const FALLBACK_TIER: PlanTier = 'pro'

/** Adds a query parameter to a URL that may already carry some. */
const withParam = (url: string, key: string, value: string): string => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${key}=${encodeURIComponent(value)}`
}

export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock'

  /** Issued subscriptions, keyed by their mock subscription id. */
  private readonly subscriptions = new Map<string, SubscriptionSnapshot>()
  private counter = 0

  private nextId(prefix: string): string {
    this.counter += 1
    return `mock_${prefix}_${this.counter}`
  }

  /** A 30-day period starting now, as ISO timestamps. */
  private currentPeriod(): { start: string; end: string } {
    const start = new Date()
    const end = new Date(start.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  /**
   * The stored snapshot for a subscription, or a freshly synthesized active
   * one. Synthesizing keeps the mock usable after a server restart, when the
   * client still holds ids from the previous process.
   */
  private snapshot(
    providerSubscriptionId: string,
    tier: PlanTier = FALLBACK_TIER,
  ): SubscriptionSnapshot {
    const existing = this.subscriptions.get(providerSubscriptionId)
    if (existing) return existing

    const period = this.currentPeriod()
    const created: SubscriptionSnapshot = {
      providerSubscriptionId,
      billingCustomerId: this.nextId('cus'),
      tier,
      status: 'active',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
    }
    this.subscriptions.set(providerSubscriptionId, created)
    return created
  }

  async createCheckoutSession({
    tier,
    successUrl,
    billingCustomerId,
  }: CheckoutRequest): Promise<CheckoutSession> {
    const providerSessionId = this.nextId('cs')
    const period = this.currentPeriod()
    const subscription: SubscriptionSnapshot = {
      providerSubscriptionId: this.nextId('sub'),
      billingCustomerId: billingCustomerId ?? this.nextId('cus'),
      tier,
      status: 'active',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
    }
    this.subscriptions.set(subscription.providerSubscriptionId, subscription)
    // No hosted page exists, so checkout "succeeds" straight back to the app.
    return {
      url: withParam(successUrl, 'session_id', providerSessionId),
      providerSessionId,
    }
  }

  async changeTier({
    providerSubscriptionId,
    tier,
  }: TierChangeRequest): Promise<SubscriptionSnapshot> {
    const updated: SubscriptionSnapshot = {
      ...this.snapshot(providerSubscriptionId, tier),
      tier,
    }
    this.subscriptions.set(providerSubscriptionId, updated)
    return updated
  }

  async createPortalSession({
    billingCustomerId,
    returnUrl,
  }: PortalRequest): Promise<PortalSession> {
    return { url: withParam(returnUrl, 'mock_portal', billingCustomerId) }
  }

  async cancelSubscription({
    providerSubscriptionId,
    atPeriodEnd = true,
  }: CancelRequest): Promise<SubscriptionSnapshot> {
    const current = this.snapshot(providerSubscriptionId)
    const updated: SubscriptionSnapshot = {
      ...current,
      status: atPeriodEnd ? current.status : 'canceled',
      cancelAtPeriodEnd: atPeriodEnd,
    }
    this.subscriptions.set(providerSubscriptionId, updated)
    return updated
  }

  /**
   * Accepts a delivery already in internal shape — `{ id, type, subscription }`
   * — so tests and dev tooling can drive billing state by POSTing plain JSON.
   * Unsigned by design: the mock never handles real money.
   */
  async parseWebhook({
    rawBody,
  }: WebhookDelivery): Promise<BillingEvent | null> {
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw new WebhookVerificationError('Webhook body is not valid JSON')
    }

    const event = payload as Partial<BillingEvent>
    if (!BILLING_EVENT_TYPES.includes(event.type as BillingEventType))
      return null
    if (!event.subscription) return null

    const subscription = this.snapshot(
      event.subscription.providerSubscriptionId,
      event.subscription.tier,
    )
    const merged: SubscriptionSnapshot = {
      ...subscription,
      ...event.subscription,
    }
    this.subscriptions.set(merged.providerSubscriptionId, merged)

    return {
      type: event.type as BillingEventType,
      providerEventId: event.providerEventId ?? this.nextId('evt'),
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      subscription: merged,
    }
  }
}

billingRegistry.register('mock', () => new MockBillingProvider())
