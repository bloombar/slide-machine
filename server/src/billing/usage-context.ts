/**
 * Metering against the ambient attribution (SPEC BILL-3).
 *
 * The attribution itself — who pays, who acted, what it was for — lives in
 * `usage-attribution.ts`, which imports nothing so that both the counters and
 * the cost ledger can read it. This file is the thin layer adapters actually
 * call: "count this against whoever is running".
 *
 * Re-exports the store's entry points so existing callers keep one import.
 */
import type { UsageMetric } from '@slide-machine/shared'
import type { PricingHint } from './pricing'
import { currentUsageUser } from './usage-attribution'
import { recordUsage } from './usage'

export {
  currentAttribution,
  currentUsageUser,
  runUnmetered,
  runWithUsage,
  type UsageAttribution,
} from './usage-attribution'

/**
 * Records usage against whoever the ambient context names. A no-op outside a
 * context, so an adapter can meter unconditionally without knowing whether its
 * caller was a user request or a background sweep.
 *
 * `pricing` is an optional hint for the cost ledger (BILL-7) — the split
 * between input and output tokens, say, which the metric itself flattens into
 * one number. It changes what the event is priced at, never what the cap is
 * charged: allowances are counted in the metric's own unit.
 */
export const meterUsage = async (
  metric: UsageMetric,
  quantity: number,
  options?: { billable?: boolean; pricing?: PricingHint },
): Promise<void> => {
  const userId = currentUsageUser()
  if (!userId || quantity <= 0) return
  await recordUsage(userId, metric, quantity, options)
}

export type { PricingHint }
