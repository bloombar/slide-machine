/**
 * The signed-in account's billing (SPEC BILL-2). Every call is scoped to the
 * caller by the server, so nothing here takes a user, a customer, or a
 * subscription id — the two redirects hand back a hosted page on the payment
 * provider, which is where card details are entered and invoices are read.
 */
import type {
  BillingRedirect,
  BillingSummary,
  PlanCatalog,
  PlanTier,
} from '@slide-machine/shared'
import { dispatchAction } from './actions'

export const fetchBillingSummary = (): Promise<BillingSummary> =>
  dispatchAction<BillingSummary>('billing.summary')

/** What every plan offers — the pricing page's table (BILL-1/BILL-6). Carries
 * no account state; which plan the caller is on comes from the summary. */
export const fetchPlanCatalog = (): Promise<PlanCatalog> =>
  dispatchAction<PlanCatalog>('billing.plans')

/** Hosted checkout for `tier`. `returnPath` is where the provider sends the
 * browser back to; the server defaults it to the account's Plan tab. */
export const startCheckout = (
  tier: PlanTier,
  returnPath?: string,
): Promise<BillingRedirect> =>
  dispatchAction<BillingRedirect>('billing.checkout', { tier, returnPath })

/** Hosted portal: payment methods, invoices, cancellation. */
export const openBillingPortal = (
  returnPath?: string,
): Promise<BillingRedirect> =>
  dispatchAction<BillingRedirect>('billing.portal', { returnPath })
