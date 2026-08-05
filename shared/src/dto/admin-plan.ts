/**
 * DTOs for complimentary plan grants (ADMIN-9): the body an admin sends to
 * put an account on a larger plan without charging for it, and the record
 * the admin surfaces read back.
 *
 * A grant never touches the account's own billing state. It sits beside it
 * with an expiry, and entitlement is the larger of the two — so ending a
 * grant, by revoking it or by letting it lapse, returns the account to
 * whatever it is paying for at that moment rather than to a stale snapshot
 * of what it was paying for when the grant was issued.
 */
import type { PlanTier } from '../types/plans'

/** What an admin sends to start or replace a grant. Sending it again with a
 * different tier or expiry replaces the standing one, so an extension is the
 * same call as the original. */
export interface AdminPlanGrantInput {
  /** The tier to put the account on. Must be **larger** than the tier its
   * own billing entitles it to: a grant is a gift, never a demotion. */
  tier: PlanTier
  /** ISO-8601 instant it lapses at; required, and must be in the future. */
  expiresAt: string
  /** Why it was given, for the audit trail. Never shown to the account. */
  note?: string
}

/**
 * A grant as the admin surfaces show it — the operator's full view,
 * including one that has already lapsed, which stays on the record as
 * history until it is replaced.
 */
export interface AdminPlanGrant {
  tier: PlanTier
  expiresAt: string
  grantedAt: string
  /** The granting admin's email, snapshotted when it was issued. */
  grantedByEmail: string
  note?: string
  /**
   * Whether it is actually deciding what the account may spend right now.
   * False once it lapses, and false while the account's own plan is at
   * least as large — a grant that has been overtaken by a real purchase
   * changes nothing, and the console says so rather than implying it does.
   */
  inEffect: boolean
}
