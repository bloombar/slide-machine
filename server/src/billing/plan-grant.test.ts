/**
 * Unit tests for complimentary plan grants (ADMIN-9) — the tier arithmetic,
 * which needs no database: when a grant counts, when it stops counting, and
 * what each surface is told about it.
 *
 * The rules under test are the ones the feature stands on: a grant raises but
 * never lowers, it stops at its expiry without anything having to run, and
 * what an account falls back to is read at that moment rather than snapshotted
 * when the grant was issued. The endpoints that write one, and the caps that
 * follow from it, are covered in test/integration/admin-plan-grant.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'
import type { PlanTier } from '@slide-machine/shared'
import {
  adminPlanGrant,
  effectivePlanTier,
  grantInEffect,
  planGrantView,
  type PlanBearing,
} from './plan-grant'

const NOW = new Date('2026-06-01T12:00:00.000Z')
const LATER = new Date('2026-07-01T00:00:00.000Z')
const EARLIER = new Date('2026-05-01T00:00:00.000Z')

/** An account on `planTier`, optionally carrying a grant of `granted`. */
const account = (
  planTier: PlanTier,
  granted?: { tier: PlanTier; expiresAt: Date },
): PlanBearing => ({
  planTier,
  planGrant: granted && {
    tier: granted.tier,
    expiresAt: granted.expiresAt,
    grantedAt: EARLIER,
    grantedBy: new Types.ObjectId(),
    grantedByEmail: 'admin@example.com',
    note: 'Pilot department',
  },
})

describe('effectivePlanTier', () => {
  it('is the account’s own tier when it has no grant', () => {
    expect(effectivePlanTier(account('fresh'), NOW)).toBe('fresh')
  })

  it('is the granted tier while the grant runs', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: LATER })
    expect(effectivePlanTier(user, NOW)).toBe('pro')
  })

  it('falls back to the billing tier once the grant expires', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: EARLIER })
    expect(effectivePlanTier(user, NOW)).toBe('fresh')
  })

  it('expires on the instant, not after it', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: NOW })
    expect(effectivePlanTier(user, NOW)).toBe('fresh')
    expect(effectivePlanTier(user, new Date(NOW.getTime() - 1))).toBe('pro')
  })

  // The reason entitlement is computed rather than stored: an account that
  // buys a bigger plan mid-grant keeps the bigger plan, and the grant lapsing
  // returns it to what it is paying for *then* — not to what it was on when
  // the grant was written.
  it('never lowers an account that has outgrown the grant', () => {
    const user = account('max', { tier: 'pro', expiresAt: LATER })
    expect(effectivePlanTier(user, NOW)).toBe('max')
    expect(grantInEffect(user, NOW)).toBeUndefined()
  })

  it('ignores a grant of the tier the account is already on', () => {
    const user = account('pro', { tier: 'pro', expiresAt: LATER })
    expect(effectivePlanTier(user, NOW)).toBe('pro')
    expect(grantInEffect(user, NOW)).toBeUndefined()
  })
})

describe('planGrantView', () => {
  it('tells the account what it has and where it lands', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: LATER })
    expect(planGrantView(user, NOW)).toEqual({
      tier: 'pro',
      expiresAt: LATER.toISOString(),
      revertsTo: 'fresh',
    })
  })

  it('says nothing when no grant is in effect', () => {
    expect(planGrantView(account('fresh'), NOW)).toBeUndefined()
    expect(
      planGrantView(account('fresh', { tier: 'pro', expiresAt: EARLIER }), NOW),
    ).toBeUndefined()
  })

  // Who granted it and why are the operator's business (ADMIN-7), not the
  // account's.
  it('never carries the granting admin or the note', () => {
    const view = planGrantView(
      account('free', { tier: 'max', expiresAt: LATER }),
      NOW,
    )
    expect(view).not.toHaveProperty('grantedByEmail')
    expect(view).not.toHaveProperty('note')
  })
})

describe('adminPlanGrant', () => {
  it('carries the operator’s full record', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: LATER })
    expect(adminPlanGrant(user, NOW)).toEqual({
      tier: 'pro',
      expiresAt: LATER.toISOString(),
      grantedAt: EARLIER.toISOString(),
      grantedByEmail: 'admin@example.com',
      note: 'Pilot department',
      inEffect: true,
    })
  })

  // A lapsed grant is history worth keeping: it is what explains the usage on
  // an account that was comped last month.
  it('keeps showing a lapsed grant, marked as no longer in effect', () => {
    const user = account('fresh', { tier: 'pro', expiresAt: EARLIER })
    expect(adminPlanGrant(user, NOW)?.inEffect).toBe(false)
  })

  it('marks a grant the account has outgrown as inert', () => {
    const user = account('max', { tier: 'pro', expiresAt: LATER })
    expect(adminPlanGrant(user, NOW)?.inEffect).toBe(false)
  })

  it('is absent for an account that never had one', () => {
    expect(adminPlanGrant(account('free'), NOW)).toBeUndefined()
  })
})
