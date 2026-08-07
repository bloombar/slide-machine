/**
 * Writing to the cost ledger (SPEC BILL-7).
 *
 * Sits beside the counters rather than inside them because the two answer
 * different questions and fail differently. `usage.ts` decides whether a user
 * may proceed and must be cheap enough to run on every paid call; this records
 * what the deployment spent and on whom, and is allowed to know about projects,
 * lectures, and money.
 *
 * Everything here is best-effort in the same way the audit log is: a ledger
 * write that fails is logged, never raised. Losing a row costs an operator
 * some accuracy in a report; failing the request costs a user their lecture.
 */
import type { UsageMetric } from '@slide-machine/shared'
import { CostEventModel, type CostActorKind } from '../models/cost-event'
import { currentAttribution } from './usage-attribution'
import { costMicrosFor, ledgerCurrency, type PricingHint } from './pricing'

/**
 * Who a row says caused the work, given what the request knew.
 *
 * Three cases, and the distinctions all earn their keep:
 *
 *  - **No context at all** is the *system*: a sweep, a backfill, work nobody
 *    asked for. It is charged to an account but caused by the deployment, and
 *    keeping it distinct stops it being read as either instructor or student
 *    spend, since it is neither and neither remedy applies to it.
 *  - **A context flagged `audience`** is a viewer, identified or not. The flag
 *    rather than an id comparison, because an anonymous student is the case
 *    this most needs to get right and they have no id to compare.
 *  - **Anything else** is the payer working on their own material.
 */
const attributionOf = (
  payerId: string,
  context: { audience?: boolean; actorId?: string } | undefined,
): { actorKind: CostActorKind; actorId: string | null } => {
  if (!context) return { actorKind: 'system', actorId: null }
  if (context.audience || (context.actorId && context.actorId !== payerId))
    return { actorKind: 'audience', actorId: context.actorId ?? null }
  return { actorKind: 'owner', actorId: context.actorId ?? payerId }
}

/** What a ledger row needs beyond what the ambient attribution supplies. */
export interface LedgerEntry {
  payerId: string
  metric: UsageMetric
  quantity: number
  /** False for a cache hit: recorded, never debited, priced at nothing. */
  billable?: boolean
  /** What the caller knows that the metric does not (input/output token
   * split, voice family), so the row is priced at the real rate. */
  pricing?: PricingHint
}

/**
 * Records one metered event.
 *
 * The project and lecture come from the ambient attribution rather than from
 * the caller, because the caller is usually a provider adapter several layers
 * down that has no idea what it is generating slides *for*. Whatever the
 * request knew when it started is what lands on the row — and if it knew
 * nothing, the row still records the payer, the service, and the money, which
 * is enough for the per-user roll-up even when the per-lecture one is blind
 * to it.
 *
 * A cache hit is priced at zero rather than skipped. It is the row that makes
 * the denominators honest: how many students a deck reached, and how much
 * caching avoided (BILL-7).
 */
export const recordCostEvent = async ({
  payerId,
  metric,
  quantity,
  billable = true,
  pricing,
}: LedgerEntry): Promise<void> => {
  try {
    const context = currentAttribution()
    // Only trust the ambient entity references when they describe the same
    // payer. A nested piece of work for a different account (a viewer's
    // playback charged to an owner) must not inherit the outer request's
    // lecture, or one deck's cost would land on another's report.
    const sameParty = !context || context.userId === payerId
    const { actorKind, actorId } = attributionOf(
      payerId,
      sameParty ? context : undefined,
    )
    await CostEventModel.create({
      payerId,
      actorId,
      actorKind,
      projectId: sameParty ? (context?.projectId ?? null) : null,
      projectName: sameParty ? context?.projectName : undefined,
      deckId: sameParty ? (context?.deckId ?? null) : null,
      deckName: sameParty ? context?.deckName : undefined,
      metric,
      quantity,
      billable,
      // Frozen here, at the rates configured right now (BILL-6). A cache hit
      // is free by definition, whatever the price list says the work costs.
      costMicros: billable ? costMicrosFor(metric, quantity, pricing) : 0,
      currency: ledgerCurrency(),
      occurredAt: new Date(),
    })
  } catch (error) {
    // Logged, never raised — the same discipline as the audit log and the
    // counters. An operator's report is worth less than a user's request.
    console.error(
      `Failed to record cost event ${metric} for ${payerId}:`,
      error,
    )
  }
}
