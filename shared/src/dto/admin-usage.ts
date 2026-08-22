/**
 * Admin allowance resets (SPEC ADMIN-10): what an operator gets back after
 * zeroing an account's counters for the billing period it is currently in.
 *
 * The response reports what was actually cleared rather than merely
 * succeeding, because a reset is invisible otherwise: an account that had
 * spent nothing and an account whose counters were wiped both end up at zero,
 * and only the "before" distinguishes them. It is the same detail the audit
 * entry carries (ADMIN-7), so the console shows the operator exactly what the
 * log will say they did.
 */
import type { UsageMetric } from '../types/plans'

/** Every counter the reset moved, and where it stood beforehand. */
export interface AdminUsageResetResponse {
  /** The billing period whose counters were zeroed — the one the caps bind
   * against right now, never a past or future one. */
  period: string
  /**
   * Metric → what it read before, for each counter that was above zero.
   * Absent metrics were already at nothing.
   *
   * Gauges (`audioStorageMb`) never appear: they measure what the account is
   * holding this instant rather than what it spent this period, so no choice
   * of period can honestly zero one.
   */
  cleared: Partial<Record<UsageMetric, number>>
}
