/**
 * Plan-cap enforcement errors (SPEC BILL-4). Kept beside the billing seam and
 * free of Express so any layer — an action, a route, the audio socket — can
 * refuse work the same way.
 */
import type { UsageMetric } from '@slide-machine/shared'

/**
 * A metered resource is exhausted for the current period. Maps to **402**: the
 * operation did not run and nothing was billed beyond the plan.
 *
 * The message is user-facing and must stay safe for a *viewer* to read — a
 * student blocked on someone else's deck learns that the content is
 * unavailable, never anything about the owner's billing state.
 */
export class PlanLimitExceededError extends Error {
  constructor(
    public readonly metric: UsageMetric,
    /** What the plan allows this period; null would mean unlimited, so a
     * limit error never carries it. */
    public readonly cap: number,
    public readonly used: number,
    message = 'This action is unavailable right now.',
  ) {
    super(message)
    this.name = 'PlanLimitExceededError'
  }
}
