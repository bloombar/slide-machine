/**
 * Billing actions (SPEC BILL-2): what the account's Plan view reads, and the
 * two doors out to the provider — hosted checkout for a new or changed
 * subscription, and the hosted portal for payment methods, invoices, and
 * cancellation.
 *
 * Every one is scoped to the caller. A subscription is the most sensitive
 * thing an account owns, so there is deliberately no way to ask for someone
 * else's, and nothing here accepts an id that names a customer or
 * subscription: those references are looked up from the signed-in account, so
 * a caller cannot open a stranger's billing portal by guessing one.
 *
 * The app never sees card data and never sets a price — the provider hosts
 * both pages, and these actions only hand back the URL to send the browser to
 * (P-8).
 */
import { z } from 'zod'
import type {
  BillingCheckoutInput,
  BillingPortalInput,
  BillingRedirect,
  BillingSummary,
  PlanCatalog,
} from '@slide-machine/shared'
import { PLAN_TIERS } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { UserModel } from '../models/user'
import { billingRegistry } from '../billing/registry'
import { BillingUnavailableError } from '../billing/errors'
import {
  billingCustomerIdFor,
  billingSummary,
  purchasableTiers,
} from '../billing/subscription'
import { planCatalog } from '../billing/catalog'

/**
 * Where the provider sends the browser back to. An in-app path, never a URL:
 * the value is pasted into a redirect target, so accepting an origin would
 * turn checkout into an open redirect. A leading `//` is rejected for the same
 * reason — browsers read it as protocol-relative, i.e. another host.
 */
const returnPath = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[\w\-./?=&%]*$/, 'must be an in-app path')
  .optional()

/** Where the Plan view lives, and so where checkout and the portal return. */
const DEFAULT_RETURN_PATH = '/app/settings?tab=plan'

/** The signed-in account, or a refusal. */
const loadSelf = async (userId: string | undefined) => {
  if (!userId) throw new ActionForbiddenError('Sign in to continue')
  const user = await UserModel.findById(userId)
  if (!user) throw new ActionForbiddenError()
  return user
}

/**
 * Absolute URL for an in-app path, optionally carrying an outcome parameter,
 * or a refusal when the deployment has not been told what origin it is served
 * at — a provider needs an absolute URL, and inventing one would strand the
 * user on a page that does not exist.
 */
const returnUrl = (
  origin: string | undefined,
  path: string,
  outcome?: string,
): string => {
  if (!origin) {
    throw new BillingUnavailableError(
      'Billing is not configured: the application has no public URL',
      false,
    )
  }
  const base = `${origin.replace(/\/+$/, '')}${path}`
  if (!outcome) return base
  return `${base}${path.includes('?') ? '&' : '?'}checkout=${outcome}`
}

/** The account's plan and subscription state (BILL-2). Read-only. */
export const billingGetSummary = defineAction<
  Record<string, never>,
  BillingSummary
>({
  name: 'billing.summary',
  input: z.object({}).strict(),
  execute: async ctx => {
    const user = await loadSelf(ctx.userId)
    return billingSummary(user._id.toString(), user.planTier)
  },
})

registerAction(billingGetSummary)

/**
 * What every plan offers, for the pricing page (BILL-1/BILL-6). The one
 * billing action that takes no account: it is the published price list, the
 * same for whoever asks, so it neither loads a user nor varies by one — which
 * tier the caller is on comes from `billing.summary` beside it.
 */
export const billingGetPlans = defineAction<Record<string, never>, PlanCatalog>(
  {
    name: 'billing.plans',
    input: z.object({}).strict(),
    execute: () => planCatalog(),
  },
)

registerAction(billingGetPlans)

/**
 * Starts a hosted checkout for `tier` and returns the page to send the
 * browser to. Nothing is recorded here: the subscription becomes real when the
 * provider's webhook says so (BILL-2), because a browser that never comes back
 * from a completed payment must still end up on the right plan.
 */
export const billingCheckout = defineAction<
  BillingCheckoutInput,
  BillingRedirect
>({
  name: 'billing.checkout',
  input: z
    .object({
      tier: z.enum(PLAN_TIERS),
      returnPath,
    })
    .strict(),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    // A tier with no price is not for sale — the free tier by definition, or
    // one this deployment has not finished configuring (BILL-6).
    if (!purchasableTiers().includes(input.tier)) {
      throw new BillingUnavailableError(
        `The ${input.tier} plan cannot be purchased here`,
        false,
      )
    }

    const userId = user._id.toString()
    const path = input.returnPath ?? DEFAULT_RETURN_PATH
    const session = await billingRegistry.get().createCheckoutSession({
      userId,
      email: user.email,
      tier: input.tier,
      successUrl: returnUrl(ctx.origin, path, 'success'),
      cancelUrl: returnUrl(ctx.origin, path, 'canceled'),
      billingCustomerId: await billingCustomerIdFor(userId),
    })
    return { url: session.url }
  },
})

registerAction(billingCheckout)

/**
 * Opens the provider's hosted portal, where the user manages payment methods,
 * reads invoices, and cancels (BILL-2/BILL-5). Requires a customer reference,
 * which only exists once the account has been through checkout.
 */
export const billingPortal = defineAction<BillingPortalInput, BillingRedirect>({
  name: 'billing.portal',
  input: z.object({ returnPath }).strict(),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    const billingCustomerId = await billingCustomerIdFor(user._id.toString())
    if (!billingCustomerId) {
      throw new BillingUnavailableError(
        'This account has no billing record to manage yet',
        false,
      )
    }

    const session = await billingRegistry.get().createPortalSession({
      billingCustomerId,
      returnUrl: returnUrl(ctx.origin, input.returnPath ?? DEFAULT_RETURN_PATH),
    })
    return { url: session.url }
  },
})

registerAction(billingPortal)
