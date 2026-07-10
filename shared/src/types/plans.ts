/**
 * Subscription plan tiers and usage caps (SPEC BILL-1/BILL-3/BILL-6).
 * The concrete values live in config/plans.json so pricing and caps can be
 * tuned without a code change.
 */
export const PLAN_TIERS = ['free', 'pro', 'max'] as const

export type PlanTier = (typeof PLAN_TIERS)[number]

/** Metered resources subject to per-tier caps. `null` means unlimited. */
export interface PlanCaps {
  geminiTokens: number | null
  sttMinutes: number | null
  imageCalls: number | null
  exports: number | null
}

export interface PlanDefinition {
  /** Billing-provider price id; null for the free tier. */
  priceId: string | null
  caps: PlanCaps
}

export type PlansConfig = Record<PlanTier, PlanDefinition>

export type UsageMetric = keyof PlanCaps
