/**
 * User, subscription, and usage data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { SubscriptionStatus } from '../billing/provider'
import type { Locale } from './locale'
import type { PlanTier, UsageMetric } from './plans'

/** Per-user defaults applied to all new projects unless overridden (GEN-8/GEN-9). */
export interface ProjectDefaults {
  manualSlideAdvance?: boolean
  animatedTransitions?: boolean
}

/** Whether a user's profile page is visible to others. */
export type ProfileVisibility = 'public' | 'private'

/**
 * A complimentary plan an admin granted an account, as the account itself
 * sees it (ADMIN-9). Present only while the grant is actually *in effect*:
 * it has not expired, and it is larger than what the account's own billing
 * entitles it to. A grant is never a downgrade, so an account that buys a
 * bigger plan mid-grant keeps the bigger plan and this disappears.
 *
 * Who granted it and why are deliberately absent — the account is told what
 * it may spend and until when, which is what it can act on; the operator's
 * side of the record lives in the admin audit log (ADMIN-7).
 */
export interface PlanGrant {
  /** The tier the account is being given, and so its current `planTier`. */
  tier: PlanTier
  /** ISO-8601 instant the grant lapses at. */
  expiresAt: string
  /**
   * The tier the account falls back to when it lapses — what its own billing
   * entitles it to *today*. A statement about now, not a promise: subscribing
   * or cancelling in the meantime changes it.
   */
  revertsTo: PlanTier
}

export interface User {
  id: string
  email: string
  displayName: string
  passwordHash?: string
  emailVerified: boolean
  profileVisibility: ProfileVisibility
  bio?: string
  avatarUrl?: string
  /** Interface language (TECH-12), only when explicitly chosen; absent
   * = whatever the browser asks for, re-matched against the supported
   * locales on every visit. */
  locale?: Locale
  /** Lecturing/generation language, only when explicitly chosen; absent
   * = browser default. Cascades: lecture ?? project ?? this ?? browser. */
  language?: Locale
  projectDefaults?: ProjectDefaults
  /**
   * What the account may spend against (BILL-3). On the wire this is the
   * **effective** tier: normally what its billing entitles it to, but the
   * granted tier while a complimentary grant is in effect (ADMIN-9). Stored,
   * it is only ever the billing one — see `planGrant`.
   */
  planTier: PlanTier
  /** An admin's complimentary plan, while one is in effect (ADMIN-9). */
  planGrant?: PlanGrant
  billingProvider?: string
  billingCustomerId?: string
  createdAt: string
}

/**
 * A user's subscription as persisted (§15). Provider-neutral by design
 * (TECH-9): a `billingProvider` discriminator plus opaque customer and
 * subscription references, never vendor-specific fields.
 */
export interface Subscription {
  id: string
  userId: string
  tier: PlanTier
  billingProvider: string
  billingCustomerId: string
  providerSubscriptionId: string
  status: SubscriptionStatus
  currentPeriodStart: string
  currentPeriodEnd: string
  /** True when the subscription lapses at period end instead of renewing. */
  cancelAtPeriodEnd: boolean
  /**
   * The provider event this row was last written from (BILL-2). Providers
   * retry deliveries and do not guarantee order, so both are kept: the id
   * discards an exact replay, the timestamp discards one that arrives late
   * and would otherwise undo a newer state.
   */
  lastEventId?: string
  lastEventAt?: string
}

/** Usage recorded against one metric for one user in one billing period (BILL-3). */
export interface UsageRecord {
  id: string
  userId: string
  period: string
  metric: UsageMetric
  used: number
  cap: number | null
}

/** OAuth connection for import/export, separate from sign-in identity (EXP-4). */
export interface ConnectedAccount {
  id: string
  userId: string
  provider: 'google' | 'github'
  scopes: string[]
  externalAccountLabel: string
  connectedAt: string
}
