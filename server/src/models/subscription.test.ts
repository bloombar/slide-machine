/**
 * Unit tests for the subscription DTO mapper: dates cross the wire as ISO
 * strings, ids as strings, and the persisted shape stays provider-neutral
 * (TECH-9) — a discriminator plus opaque references, no vendor fields.
 */
import { describe, it, expect } from 'vitest'
import { Types, type HydratedDocument } from 'mongoose'
import { toSubscriptionDto, type SubscriptionDb } from './subscription'

const userId = new Types.ObjectId()
const subscriptionId = new Types.ObjectId()

const doc = {
  _id: subscriptionId,
  userId,
  tier: 'pro',
  billingProvider: 'stripe',
  billingCustomerId: 'cus_123',
  providerSubscriptionId: 'sub_123',
  status: 'active',
  currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
  cancelAtPeriodEnd: false,
} as HydratedDocument<SubscriptionDb>

describe('toSubscriptionDto', () => {
  it('maps a subscription document to the wire shape', () => {
    expect(toSubscriptionDto(doc)).toEqual({
      id: subscriptionId.toString(),
      userId: userId.toString(),
      tier: 'pro',
      billingProvider: 'stripe',
      billingCustomerId: 'cus_123',
      providerSubscriptionId: 'sub_123',
      status: 'active',
      currentPeriodStart: '2026-01-01T00:00:00.000Z',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    })
  })

  it('exposes no vendor-specific fields', () => {
    const dto = toSubscriptionDto({
      ...doc,
      // A stray vendor field on the document must not reach the client.
      stripePriceId: 'price_pro',
    } as unknown as HydratedDocument<SubscriptionDb>)

    expect(Object.keys(dto)).not.toContain('stripePriceId')
  })
})
