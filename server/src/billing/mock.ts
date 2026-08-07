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
  PlanPrice,
  PlanTier,
  PortalRequest,
  PortalSession,
  SubscriptionSnapshot,
  TierChangeRequest,
  WebhookDelivery,
} from '@slide-machine/shared'
import { BILLING_EVENT_TYPES, PLAN_TIERS } from '@slide-machine/shared'
import { loadPlans } from '../config/plans'
import { env } from '../config/env'
import { billingRegistry } from './registry'
import { WebhookVerificationError } from './errors'

/** Length of a mock billing period. */
const PERIOD_DAYS = 30

/**
 * Monthly price, in cents, the mock quotes for the n-th paid tier — a
 * stand-in for what a real provider would hold, so dev and e2e see a filled-in
 * pricing table instead of a column of blanks. Tiers beyond the list reuse the
 * last figure rather than inventing an ever-growing one.
 */
const MOCK_PRICES_MINOR = [900, 2900, 9900]

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
    userId?: string,
  ): SubscriptionSnapshot {
    const existing = this.subscriptions.get(providerSubscriptionId)
    if (existing) return existing

    const period = this.currentPeriod()
    const created: SubscriptionSnapshot = {
      providerSubscriptionId,
      billingCustomerId: this.nextId('cus'),
      userId,
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
    userId,
    tier,
    successUrl,
    billingCustomerId,
  }: CheckoutRequest): Promise<CheckoutSession> {
    const providerSessionId = this.nextId('cs')
    const period = this.currentPeriod()
    const subscription: SubscriptionSnapshot = {
      providerSubscriptionId: this.nextId('sub'),
      billingCustomerId: billingCustomerId ?? this.nextId('cus'),
      userId,
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

  /**
   * A monthly price per known price id. The ids come from the plans config,
   * so which tier each belongs to is looked up there rather than parsed out of
   * the id — an id is opaque to everyone but the provider that issued it, and
   * the mock is only pretending to be one.
   */
  async listPrices(priceIds: string[]): Promise<Record<string, PlanPrice>> {
    const plans = loadPlans()
    // Paid tiers in order, so the n-th one gets the n-th mock price.
    const paid = PLAN_TIERS.filter(tier => plans[tier]?.priceId)

    const priced = priceIds
      .map(id => {
        const index = paid.findIndex(tier => plans[tier]?.priceId === id)
        if (index === -1) return null
        const amountMinor =
          MOCK_PRICES_MINOR[Math.min(index, MOCK_PRICES_MINOR.length - 1)]!
        return [
          id,
          { amountMinor, currency: 'usd', interval: 'month', intervalCount: 1 },
        ] as const
      })
      .filter(entry => entry !== null)

    return Object.fromEntries(priced)
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
   *
   * Which is exactly why it refuses to run in production (P-8). The webhook
   * route is unauthenticated because its caller is a payment provider rather
   * than a user, so a signature is the only thing distinguishing the provider
   * from a stranger — and an unsigned parser behind that route turns "POST
   * this JSON" into "put any account on any plan". Configuration already
   * refuses to boot in this state (`config/env.ts`); this is the second lock,
   * on the door itself, because the cost of being wrong here is every
   * subscription in the deployment.
   */
  async parseWebhook({
    rawBody,
  }: WebhookDelivery): Promise<BillingEvent | null> {
    if (env.NODE_ENV === 'production') {
      throw new WebhookVerificationError(
        'The mock billing provider does not verify webhooks and is not usable in production',
      )
    }
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
      event.subscription.userId,
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
