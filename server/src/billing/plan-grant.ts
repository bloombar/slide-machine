/**
 * Complimentary plan grants (SPEC ADMIN-9): an admin puts an account on a
 * larger plan for a while without charging for it, and it drops back on its
 * own when the grant lapses.
 *
 * The whole design is one decision: **a grant is stored beside the account's
 * billing tier, never in it.** `user.planTier` remains what the provider's
 * webhooks say the account is entitled to (BILL-2), the grant is a separate
 * record with an expiry, and what the account may spend is computed from the
 * pair. Three things fall out of that, all of which the alternative — writing
 * the granted tier into `planTier` and remembering the old one — gets wrong:
 *
 * 1. **Lapsing needs no bookkeeping.** There is no sweep to run, nothing to
 *    write back, and no window where a job that did not run leaves an account
 *    on a plan nobody is paying for. The grant simply stops counting.
 * 2. **Reverting lands on the truth.** An account returns to what its billing
 *    entitles it to *at that moment*, not to a snapshot of what it was on when
 *    the grant was issued — so subscribing, upgrading, or cancelling during a
 *    grant is not undone by its expiry.
 * 3. **A webhook can never clobber it, and it can never clobber a webhook.**
 *    The two write different fields.
 *
 * A grant only ever raises: entitlement is the larger of the two tiers. An
 * account that buys a bigger plan mid-grant keeps the bigger plan, and no
 * complimentary plan can quietly take away something someone paid for.
 */
import type { Types } from 'mongoose'
import {
  planRank,
  type AdminPlanGrant,
  type PlanGrant,
  type PlanTier,
} from '@slide-machine/shared'

/**
 * A grant as stored on the account. The operator's half of the record — who
 * gave it and why — is server-side only: the account is told the tier and the
 * date, which is what it can act on, and the audit log holds the rest
 * (ADMIN-7).
 */
export interface PlanGrantDb {
  tier: PlanTier
  expiresAt: Date
  grantedAt: Date
  grantedBy: Types.ObjectId
  /** The granting admin's email, snapshotted — as the audit log does, so the
   * record still reads if that account is later renamed or deleted. */
  grantedByEmail: string
  note?: string
}

/**
 * The account fields a tier decision reads. A structural type rather than the
 * user document, so this module stays free of mongoose models — including the
 * one that imports it — and so a `.select()`ed projection satisfies it.
 */
export interface PlanBearing {
  planTier: PlanTier
  planGrant?: PlanGrantDb | null
}

/**
 * The projection every `.select()` needs in order to decide a tier. Selecting
 * `planTier` alone would silently drop the grant and meter a comped account
 * against its own plan, so the two fields are named together, once.
 */
export const PLAN_FIELDS = 'planTier planGrant'

/**
 * The grant that is actually deciding what this account may spend, if any.
 *
 * A grant counts only while it is both unexpired and larger than the
 * account's own tier. The second test is what makes a grant unable to demote:
 * one that has been overtaken by a real purchase stops applying, rather than
 * holding the account down at the tier it was given.
 */
export const grantInEffect = (
  user: PlanBearing,
  now: Date = new Date(),
): PlanGrantDb | undefined => {
  const grant = user.planGrant
  if (!grant) return undefined
  if (grant.expiresAt.getTime() <= now.getTime()) return undefined
  if (planRank(grant.tier) <= planRank(user.planTier)) return undefined
  return grant
}

/** What the account may spend against: its own tier, raised by a grant in
 * effect. The one answer every cap check, usage view, and plan badge uses. */
export const effectivePlanTier = (
  user: PlanBearing,
  now: Date = new Date(),
): PlanTier => grantInEffect(user, now)?.tier ?? user.planTier

/**
 * The grant as the account itself is told about it, or undefined when nothing
 * is in effect. `revertsTo` is today's billing tier — what it would fall back
 * to if the grant lapsed now, not a promise about the date itself.
 */
export const planGrantView = (
  user: PlanBearing,
  now: Date = new Date(),
): PlanGrant | undefined => {
  const grant = grantInEffect(user, now)
  if (!grant) return undefined
  return {
    tier: grant.tier,
    expiresAt: grant.expiresAt.toISOString(),
    revertsTo: user.planTier,
  }
}

/**
 * The grant as an operator sees it: the standing record whether or not it is
 * still deciding anything, so the console can show a lapsed grant as history
 * and an overtaken one as inert instead of dropping both.
 */
export const adminPlanGrant = (
  user: PlanBearing,
  now: Date = new Date(),
): AdminPlanGrant | undefined => {
  const grant = user.planGrant
  if (!grant) return undefined
  return {
    tier: grant.tier,
    expiresAt: grant.expiresAt.toISOString(),
    grantedAt: grant.grantedAt.toISOString(),
    grantedByEmail: grant.grantedByEmail,
    note: grant.note,
    inEffect: Boolean(grantInEffect(user, now)),
  }
}
