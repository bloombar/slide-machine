/**
 * Stripe BillingProvider adapter (SPEC TECH-9/BILL-2) — the pilot's default.
 * The only module that knows Stripe object shapes, API parameters, and
 * webhook signing; everything above it sees the vendor-neutral interface.
 * Talks to the REST API with plain fetch and a secret key (no SDK), the same
 * pattern as the Gemini and Google Cloud adapters.
 *
 * Price ids are vendor-specific and live per tier in config/plans.json
 * (BILL-6), so pricing changes stay configuration.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  BillingEvent,
  BillingEventType,
  BillingProvider,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  PlanTier,
  PlansConfig,
  PortalRequest,
  PortalSession,
  SubscriptionSnapshot,
  SubscriptionStatus,
  TierChangeRequest,
  WebhookDelivery,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { loadPlans } from '../config/plans'
import { billingRegistry } from './registry'
import { BillingUnavailableError, WebhookVerificationError } from './errors'

const API_BASE = 'https://api.stripe.com/v1'

/** Bounded so a hung Stripe call can't stall the request awaiting it. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * How far a webhook's signed timestamp may drift before it is rejected as a
 * possible replay. Matches Stripe's own recommended tolerance.
 */
const SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Stripe subscription statuses mapped onto the three the application knows.
 * Statuses absent here (notably `incomplete`, a checkout that never finished
 * paying) carry no billing meaning for us and are ignored.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
}

/** Internal event emitted for each internal status. */
const EVENT_FOR_STATUS: Record<SubscriptionStatus, BillingEventType> = {
  active: 'subscription.active',
  past_due: 'subscription.past_due',
  canceled: 'subscription.canceled',
}

/** Stripe subscription events we normalize; all others are ignored. */
const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

/** The slice of a Stripe subscription object this adapter reads. */
interface StripeSubscription {
  id?: string
  customer?: string
  status?: string
  /** Set from `subscription_data[metadata][userId]` at checkout, so every
   * later webhook names the account without a lookup table. */
  metadata?: { userId?: string }
  cancel_at_period_end?: boolean
  current_period_start?: number
  current_period_end?: number
  items?: {
    data?: {
      id?: string
      price?: { id?: string }
      current_period_start?: number
      current_period_end?: number
    }[]
  }
}

interface StripeEvent {
  id?: string
  type?: string
  created?: number
  data?: { object?: StripeSubscription }
}

/** Unix seconds → ISO-8601, falling back to the epoch when Stripe omits it. */
const toIso = (seconds: number | undefined): string =>
  new Date((seconds ?? 0) * 1000).toISOString()

/**
 * Period bounds of a subscription. Newer API versions carry these on the
 * subscription item rather than the subscription itself, so both are read.
 */
const periodOf = (
  subscription: StripeSubscription,
): { start: string; end: string } => {
  const item = subscription.items?.data?.[0]
  return {
    start: toIso(
      subscription.current_period_start ?? item?.current_period_start,
    ),
    end: toIso(subscription.current_period_end ?? item?.current_period_end),
  }
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe'

  constructor(private readonly plans: PlansConfig = loadPlans()) {}

  /** The Stripe price id backing a tier; the free tier has none to buy. */
  private priceIdFor(tier: PlanTier): string {
    const priceId = this.plans[tier]?.priceId
    if (!priceId) {
      throw new BillingUnavailableError(
        `Plan "${tier}" has no billing price configured`,
        false,
      )
    }
    return priceId
  }

  /** Reverse lookup: which tier a Stripe price id belongs to. */
  private tierForPriceId(priceId: string | undefined): PlanTier {
    const match = (
      Object.entries(this.plans) as [PlanTier, { priceId: string | null }][]
    ).find(([, plan]) => plan.priceId !== null && plan.priceId === priceId)
    // An unrecognized price means the subscription buys nothing we sell —
    // treat it as the free tier rather than granting unknown entitlements.
    return match ? match[0] : 'free'
  }

  /** POSTs form-encoded parameters to the Stripe API and parses the reply. */
  private async request<T>(
    path: string,
    params?: Record<string, string>,
    method: 'POST' | 'GET' | 'DELETE' = 'POST',
  ): Promise<T> {
    if (!env.STRIPE_SECRET_KEY) {
      throw new BillingUnavailableError('Billing is not configured', false)
    }

    let res: Response
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params ? new URLSearchParams(params).toString() : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new BillingUnavailableError(
        'The billing service is temporarily unreachable. Please try again.',
        true,
      )
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // 429s and 5xx are transient; a 4xx is a rejection that will repeat.
      const retryable = res.status === 429 || res.status >= 500
      throw new BillingUnavailableError(
        retryable
          ? 'The billing service is busy. Please try again in a moment.'
          : `The billing service rejected the request (${res.status})${detail ? `: ${detail}` : ''}`,
        retryable,
      )
    }
    return (await res.json()) as T
  }

  /** Normalizes a Stripe subscription object into the internal snapshot. */
  private toSnapshot(subscription: StripeSubscription): SubscriptionSnapshot {
    const period = periodOf(subscription)
    return {
      providerSubscriptionId: subscription.id ?? '',
      billingCustomerId: subscription.customer ?? '',
      userId: subscription.metadata?.userId,
      tier: this.tierForPriceId(subscription.items?.data?.[0]?.price?.id),
      status: STATUS_MAP[subscription.status ?? ''] ?? 'canceled',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    }
  }

  async createCheckoutSession({
    userId,
    email,
    tier,
    successUrl,
    cancelUrl,
    billingCustomerId,
  }: CheckoutRequest): Promise<CheckoutSession> {
    const params: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': this.priceIdFor(tier),
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Both are echoed back on the webhook, so the completed subscription
      // can be attributed to an account without a lookup table.
      client_reference_id: userId,
      'subscription_data[metadata][userId]': userId,
    }
    // Reusing the customer keeps one billing record per account; without one
    // Stripe creates the customer from the email at checkout.
    if (billingCustomerId) params.customer = billingCustomerId
    else params.customer_email = email

    const session = await this.request<{ id?: string; url?: string }>(
      '/checkout/sessions',
      params,
    )
    if (!session.url) {
      throw new BillingUnavailableError(
        'The billing service did not return a checkout page',
        true,
      )
    }
    return { url: session.url, providerSessionId: session.id ?? '' }
  }

  async changeTier({
    providerSubscriptionId,
    tier,
  }: TierChangeRequest): Promise<SubscriptionSnapshot> {
    // Swapping the price needs the existing item's id, so read before write.
    const current = await this.request<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      undefined,
      'GET',
    )
    const itemId = current.items?.data?.[0]?.id
    if (!itemId) {
      throw new BillingUnavailableError(
        'The subscription has no billable item to change',
        false,
      )
    }

    const updated = await this.request<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      {
        'items[0][id]': itemId,
        'items[0][price]': this.priceIdFor(tier),
        // Stripe computes the credit/charge for the mid-period switch (BILL-5).
        proration_behavior: 'create_prorations',
      },
    )
    return this.toSnapshot(updated)
  }

  async createPortalSession({
    billingCustomerId,
    returnUrl,
  }: PortalRequest): Promise<PortalSession> {
    const session = await this.request<{ url?: string }>(
      '/billing_portal/sessions',
      { customer: billingCustomerId, return_url: returnUrl },
    )
    if (!session.url) {
      throw new BillingUnavailableError(
        'The billing service did not return a portal page',
        true,
      )
    }
    return { url: session.url }
  }

  async cancelSubscription({
    providerSubscriptionId,
    atPeriodEnd = true,
  }: CancelRequest): Promise<SubscriptionSnapshot> {
    const path = `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`
    const subscription = atPeriodEnd
      ? await this.request<StripeSubscription>(path, {
          cancel_at_period_end: 'true',
        })
      : await this.request<StripeSubscription>(path, undefined, 'DELETE')
    return this.toSnapshot(subscription)
  }

  /**
   * Verifies the `Stripe-Signature` header over the raw body, then normalizes
   * subscription events. Anything else — other event types, statuses with no
   * internal meaning — resolves to null; verification failures throw.
   */
  async parseWebhook({
    rawBody,
    headers,
  }: WebhookDelivery): Promise<BillingEvent | null> {
    verifySignature(rawBody, headers['stripe-signature'])

    const event = JSON.parse(rawBody) as StripeEvent
    if (!SUBSCRIPTION_EVENT_TYPES.has(event.type ?? '')) return null

    const subscription = event.data?.object
    if (!subscription) return null

    const status = STATUS_MAP[subscription.status ?? '']
    if (!status) return null

    return {
      type: EVENT_FOR_STATUS[status],
      providerEventId: event.id ?? '',
      occurredAt: toIso(event.created),
      subscription: { ...this.toSnapshot(subscription), status },
    }
  }
}

/**
 * Checks a `Stripe-Signature` header: `t=<unix>,v1=<hmac>` where the HMAC is
 * SHA-256 of `<t>.<rawBody>` keyed by the endpoint secret. Compared in
 * constant time, and rejected outright once the timestamp falls outside the
 * replay window.
 */
export const verifySignature = (
  rawBody: string,
  header: string | undefined,
): void => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new WebhookVerificationError('Webhook verification is not configured')
  }
  if (!header) throw new WebhookVerificationError('Missing webhook signature')

  const parts = new Map(
    header.split(',').map(part => {
      const index = part.indexOf('=')
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()]
    }),
  )
  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (!timestamp || !signature) {
    throw new WebhookVerificationError('Malformed webhook signature')
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (
    !Number.isFinite(ageSeconds) ||
    ageSeconds > SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new WebhookVerificationError('Webhook timestamp outside tolerance')
  }

  const expected = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  const received = Buffer.from(signature, 'utf8')
  const digest = Buffer.from(expected, 'utf8')
  if (received.length !== digest.length || !timingSafeEqual(received, digest)) {
    throw new WebhookVerificationError('Webhook signature does not match')
  }
}

billingRegistry.register('stripe', () => new StripeBillingProvider())
