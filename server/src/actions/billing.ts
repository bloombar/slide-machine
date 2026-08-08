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
  PlanChangeImpact,
  PlanChangeInput,
  PlanChangeResult,
} from '@slide-machine/shared'
import { PLAN_TIERS } from '@slide-machine/shared'
import { defineAction } from './define'
import { open, self, type SelfAccess } from './access'
import { registerAction } from './dispatch'
import { billingRegistry } from '../billing/registry'
import { BillingUnavailableError } from '../billing/errors'
import {
  applySubscriptionSnapshot,
  billingCustomerIdFor,
  billingSummary,
  providerSubscriptionIdFor,
  purchasableTiers,
} from '../billing/subscription'
import { planCatalog } from '../billing/catalog'
import { planChangeImpact } from '../billing/plan-change'

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
  BillingSummary,
  SelfAccess
>({
  name: 'billing.summary',
  access: self(),
  input: z.object({}).strict(),
  execute: async (_ctx, _input, { user }) => {
    return billingSummary(user._id.toString(), user)
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
    // The published price list: the same for everyone, and it loads no
    // account, so there is nothing further to decide.
    access: open(),
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
  BillingRedirect,
  SelfAccess
>({
  name: 'billing.checkout',
  access: self(),
  input: z
    .object({
      tier: z.enum(PLAN_TIERS),
      returnPath,
    })
    .strict(),
  execute: async (ctx, input, { user }) => {
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
 * What moving to `tier` would do, before anything is changed (BILL-5). Read
 * by the confirmation dialog: a smaller plan keeps lecture audio for fewer
 * days, and the recordings that puts past the limit are named here so the user
 * can decline while they still have them (P-10).
 *
 * A preview never changes anything, so it answers for any tier — including one
 * the account cannot move to from here, which it reports as `changeable:
 * false` rather than refusing.
 */
export const billingChangePreview = defineAction<
  PlanChangeInput,
  PlanChangeImpact,
  SelfAccess
>({
  name: 'billing.changePreview',
  access: self(),
  input: z.object({ tier: z.enum(PLAN_TIERS) }).strict(),
  execute: async (ctx, input, { user }) => {
    return planChangeImpact(user._id.toString(), user.planTier, input.tier)
  },
})

registerAction(billingChangePreview)

/**
 * Moves the account down to `tier` (BILL-5), which the user has just been
 * shown the cost of. Only downwards: moving up is a purchase, and a purchase
 * is hosted checkout.
 *
 * Moving to free is a cancellation and runs to the end of the paid period;
 * every other move is immediate, with the provider prorating it. The provider
 * answers with the updated subscription, which is applied here rather than
 * waited for — the webhook saying the same thing may arrive after the page has
 * already re-read the plan.
 */
export const billingChange = defineAction<
  PlanChangeInput,
  PlanChangeResult,
  SelfAccess
>({
  name: 'billing.change',
  access: self(),
  input: z.object({ tier: z.enum(PLAN_TIERS) }).strict(),
  execute: async (ctx, input, { user }) => {
    const userId = user._id.toString()
    const impact = await planChangeImpact(userId, user.planTier, input.tier)
    if (!impact.changeable) {
      // Three refusals, told apart because they need different answers: stay
      // put, buy the larger plan, or there is no subscription to move at all.
      if (input.tier === user.planTier) {
        throw new BillingUnavailableError(
          `This account is already on the ${input.tier} plan`,
          false,
        )
      }
      throw new BillingUnavailableError(
        impact.isDowngrade
          ? 'This account has no subscription to change'
          : `Moving to the ${input.tier} plan goes through checkout`,
        false,
      )
    }

    const subscriptionId = await providerSubscriptionIdFor(userId)
    if (!subscriptionId) {
      throw new BillingUnavailableError(
        'This account has no subscription to change',
        false,
      )
    }

    const provider = billingRegistry.get()
    const snapshot =
      input.tier === 'free'
        ? await provider.cancelSubscription({
            providerSubscriptionId: subscriptionId,
            atPeriodEnd: true,
          })
        : await provider.changeTier({
            providerSubscriptionId: subscriptionId,
            tier: input.tier,
          })

    const applied = await applySubscriptionSnapshot(snapshot, provider.name)
    // The tier just applied, not the one on the document we loaded before the
    // change. The grant rides along untouched: changing what the account pays
    // for neither grants nor revokes a complimentary plan (ADMIN-9), and a
    // grant that still outranks the new tier keeps deciding what it may spend.
    return {
      summary: await billingSummary(userId, {
        planTier: applied.tier ?? user.planTier,
        planGrant: user.planGrant,
      }),
    }
  },
})

registerAction(billingChange)

/**
 * Opens the provider's hosted portal, where the user manages payment methods,
 * reads invoices, and cancels (BILL-2/BILL-5). Requires a customer reference,
 * which only exists once the account has been through checkout.
 */
export const billingPortal = defineAction<
  BillingPortalInput,
  BillingRedirect,
  SelfAccess
>({
  name: 'billing.portal',
  access: self(),
  input: z.object({ returnPath }).strict(),
  execute: async (ctx, input, { user }) => {
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
