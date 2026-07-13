/**
 * User, subscription, and usage data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
import type { PlanTier, UsageMetric } from './plans'

/** Per-user defaults applied to all new projects unless overridden (GEN-8/GEN-9). */
export interface ProjectDefaults {
  manualSlideAdvance?: boolean
  animatedTransitions?: boolean
}

/** Whether a user's profile page is visible to others. */
export type ProfileVisibility = 'public' | 'private'

export interface User {
  id: string
  email: string
  displayName: string
  passwordHash?: string
  emailVerified: boolean
  profileVisibility: ProfileVisibility
  bio?: string
  avatarUrl?: string
  locale: Locale
  /** Lecturing/generation language, only when explicitly chosen; absent
   * = browser default. Cascades: lecture ?? project ?? this ?? browser. */
  language?: Locale
  projectDefaults?: ProjectDefaults
  planTier: PlanTier
  billingProvider?: string
  billingCustomerId?: string
  createdAt: string
}

export interface Subscription {
  id: string
  userId: string
  tier: PlanTier
  billingProvider: string
  providerSubscriptionId: string
  status: 'active' | 'past_due' | 'canceled'
  currentPeriodStart: string
  currentPeriodEnd: string
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
