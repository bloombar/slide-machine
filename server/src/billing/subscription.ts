/**
 * Subscription state (SPEC BILL-2): the one place a provider's view of what a
 * user is paying for becomes this application's view of what they may spend.
 *
 * The provider is the system of record for billing, so this module only ever
 * *follows* it — every write here originates in a normalized `BillingEvent`
 * (TECH-9), never in a local guess about what a payment probably did. Two
 * facts about webhooks shape the rest:
 *
 * 1. **They are retried, and they arrive out of order.** A delivery may be a
 *    duplicate of one already applied, or an older state that must not undo a
 *    newer one. Both are discarded rather than applied twice or backwards.
 * 2. **They may arrive before anything local exists.** The first event for a
 *    new subscription can beat the browser back from checkout, so the account
 *    is identified from the event itself rather than from a row we hope was
 *    written first.
 *
 * Entitlement lives on `user.planTier`, which is what the caps are read from
 * (BILL-3); the subscription row is the billing record behind it. Keeping the
 * two in one function is deliberate — a tier that disagrees with what the user
 * is paying for is either free service or a false refusal.
 */
import type {
  BillingEvent,
  BillingSummary,
  PlanTier,
  SubscriptionSnapshot,
  SubscriptionStatus,
} from '@slide-machine/shared'
import { PLAN_TIERS } from '@slide-machine/shared'
import { Types } from 'mongoose'
import { loadPlans } from '../config/plans'
import { SubscriptionModel } from '../models/subscription'
import { UserModel } from '../models/user'

/** Why an event was not applied, for the caller to log. Never an error: an
 * event we decline to act on is a success from the provider's point of view,
 * and answering anything else only buys a retry that will be declined too. */
export type SkipReason =
  'duplicate' | 'stale' | 'superseded' | 'unattributed' | 'unknown-user'

export interface ApplyResult {
  applied: boolean
  reason?: SkipReason
  userId?: string
  tier?: PlanTier
}

/**
 * What a subscription in each state entitles the account to.
 *
 * `past_due` keeps the tier: the provider is still retrying the payment, and
 * the subscription has not ended. Revoking entitlement at the first failed
 * charge would cut a user off mid-lecture over a card that expired, and the
 * provider tells us plainly when it has given up — that event is
 * `subscription.canceled`, and this drops them to free then.
 */
const tierForStatus = (status: SubscriptionStatus, tier: PlanTier): PlanTier =>
  status === 'canceled' ? 'free' : tier

/** Whether `candidate` is a real account id we can attribute billing to. */
const knownUser = async (candidate: string | undefined): Promise<boolean> => {
  if (!candidate || !Types.ObjectId.isValid(candidate)) return false
  return (await UserModel.exists({ _id: candidate })) !== null
}

/**
 * Which account an event belongs to. The provider's own metadata is preferred
 * — it is set at checkout and survives everything after — and the opaque
 * references are the fallback for a provider that does not echo it back.
 */
const attribute = async (
  snapshot: SubscriptionSnapshot,
): Promise<{ userId?: string; reason?: SkipReason }> => {
  if (snapshot.userId) {
    if (await knownUser(snapshot.userId)) return { userId: snapshot.userId }
    // The provider named an account that is not ours — a deleted user, or a
    // webhook endpoint pointed at the wrong deployment. Either way, guessing
    // from the customer id would attribute a stranger's payment to somebody.
    return { reason: 'unknown-user' }
  }

  const bySubscription = await SubscriptionModel.findOne({
    providerSubscriptionId: snapshot.providerSubscriptionId,
  }).select('userId')
  if (bySubscription) return { userId: bySubscription.userId.toString() }

  const byCustomer = snapshot.billingCustomerId
    ? await SubscriptionModel.findOne({
        billingCustomerId: snapshot.billingCustomerId,
      }).select('userId')
    : null
  if (byCustomer) return { userId: byCustomer.userId.toString() }

  return { reason: 'unattributed' }
}

/**
 * Applies a normalized billing event: records the subscription and moves the
 * account onto the tier it now entitles. Idempotent, and safe to call with
 * deliveries that are duplicated, late, or about a subscription the user has
 * already replaced.
 *
 * `providerName` is the adapter that produced the event, stored so a future
 * migration can tell which vendor's opaque ids a row holds (TECH-9).
 */
export const applyBillingEvent = async (
  event: BillingEvent,
  providerName: string,
): Promise<ApplyResult> => {
  const snapshot = event.subscription
  const { userId, reason } = await attribute(snapshot)
  if (!userId) return { applied: false, reason }

  const existing = await SubscriptionModel.findOne({ userId })
  const occurredAt = new Date(event.occurredAt)

  if (existing) {
    // The same delivery twice — the common case, since providers retry until
    // they see a 2xx and the first attempt may well have succeeded.
    if (
      event.providerEventId &&
      existing.lastEventId === event.providerEventId
    ) {
      return { applied: false, reason: 'duplicate', userId }
    }
    // An older state than the one already recorded. Applying it would move
    // the account backwards to something the provider has since replaced.
    if (
      existing.lastEventAt &&
      Number.isFinite(occurredAt.getTime()) &&
      occurredAt < existing.lastEventAt
    ) {
      return { applied: false, reason: 'stale', userId }
    }
    // A different subscription than the live one. Cancellation of a *replaced*
    // subscription is the ordinary tail of an upgrade — the provider ends the
    // old one after starting the new — and must not cancel the new plan.
    if (
      existing.providerSubscriptionId !== snapshot.providerSubscriptionId &&
      event.type === 'subscription.canceled'
    ) {
      return { applied: false, reason: 'superseded', userId }
    }
  }

  const tier = tierForStatus(snapshot.status, snapshot.tier)

  // Keyed on the user: one live subscription per account, so re-subscribing
  // after a cancellation replaces the row rather than colliding with it.
  await SubscriptionModel.updateOne(
    { userId },
    {
      $set: {
        tier: snapshot.tier,
        billingProvider: providerName,
        billingCustomerId: snapshot.billingCustomerId,
        providerSubscriptionId: snapshot.providerSubscriptionId,
        status: snapshot.status,
        currentPeriodStart: new Date(snapshot.currentPeriodStart),
        currentPeriodEnd: new Date(snapshot.currentPeriodEnd),
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        lastEventId: event.providerEventId,
        lastEventAt: Number.isFinite(occurredAt.getTime())
          ? occurredAt
          : new Date(),
      },
      $setOnInsert: { userId },
    },
    { upsert: true },
  )

  await UserModel.updateOne({ _id: userId }, { $set: { planTier: tier } })

  return { applied: true, userId, tier }
}

/** The provider's customer reference for an account, if it has ever been
 * billed. Checkout reuses it so one account keeps one billing record, and the
 * portal cannot be opened without it. */
export const billingCustomerIdFor = async (
  userId: string,
): Promise<string | undefined> => {
  const sub = await SubscriptionModel.findOne({ userId }).select(
    'billingCustomerId',
  )
  return sub?.billingCustomerId || undefined
}

/** Tiers a checkout can be started for: those the deployment has priced
 * (BILL-6). Free has no price by definition, and an unpriced paid tier is one
 * a deployment has not finished configuring — offering it would send the user
 * to a checkout that cannot be built. */
export const purchasableTiers = (): PlanTier[] => {
  const plans = loadPlans()
  return PLAN_TIERS.filter(tier => Boolean(plans[tier]?.priceId))
}

/**
 * The account's billing state for the Plan view (BILL-2). The tier comes from
 * the user rather than the subscription because the user is what the caps are
 * read from: if the two ever disagree, the page must show what the account
 * will actually be allowed to do.
 */
export const billingSummary = async (
  userId: string,
  tier: PlanTier,
): Promise<BillingSummary> => {
  const sub = await SubscriptionModel.findOne({ userId })
  return {
    tier,
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    canManageBilling: Boolean(sub?.billingCustomerId),
    purchasableTiers: purchasableTiers(),
  }
}
