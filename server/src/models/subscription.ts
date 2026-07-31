/**
 * Subscription model (SPEC §15/TECH-9). Deliberately provider-neutral: a
 * `billingProvider` discriminator plus opaque customer and subscription
 * references, so switching vendors is an adapter plus a data backfill rather
 * than a schema change. One live subscription per user.
 */
import { Schema, model, type HydratedDocument, type Types } from 'mongoose'
import { SUBSCRIPTION_STATUSES, type Subscription } from '@slide-machine/shared'
import { PLAN_TIERS } from '@slide-machine/shared'

export interface SubscriptionDb extends Omit<
  Subscription,
  'id' | 'userId' | 'currentPeriodStart' | 'currentPeriodEnd'
> {
  userId: Types.ObjectId
  currentPeriodStart: Date
  currentPeriodEnd: Date
}

const subscriptionSchema = new Schema<SubscriptionDb>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  tier: { type: String, enum: PLAN_TIERS, required: true },
  billingProvider: { type: String, required: true },
  billingCustomerId: { type: String, required: true },
  // Unique so a replayed webhook cannot create a second row for one
  // subscription; the id is opaque and provider-scoped.
  providerSubscriptionId: { type: String, required: true, unique: true },
  status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  cancelAtPeriodEnd: { type: Boolean, default: false },
})

export const SubscriptionModel = model<SubscriptionDb>(
  'Subscription',
  subscriptionSchema,
)

/** Maps a subscription document to the wire shape. */
export const toSubscriptionDto = (
  doc: HydratedDocument<SubscriptionDb>,
): Subscription => ({
  id: doc._id.toString(),
  userId: doc.userId.toString(),
  tier: doc.tier,
  billingProvider: doc.billingProvider,
  billingCustomerId: doc.billingCustomerId,
  providerSubscriptionId: doc.providerSubscriptionId,
  status: doc.status,
  currentPeriodStart: doc.currentPeriodStart.toISOString(),
  currentPeriodEnd: doc.currentPeriodEnd.toISOString(),
  cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
})
