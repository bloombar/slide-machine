# Stripe setup (billing provider)

Everything the app needs from Stripe: a **product catalog** (one recurring
price per paid tier), a **secret API key**, and a **webhook endpoint**. Payment
pages are hosted by Stripe — the app never sees a card
([P-8](SPEC.md#16-privacy-security--compliance)) — so there is no client-side
Stripe key and nothing to install; the server talks to the REST API directly
([DECISIONS.md](DECISIONS.md#billing-abstraction-one-adapter-seam-no-vendor-sdk-2026-07-31)).

**Do this in a sandbox first.** Stripe keeps test and live completely separate:
separate products, separate price ids, separate API keys, separate webhooks.
Nothing crosses over — a sandbox price id used with a live key fails, and vice
versa. The steps below are identical in both, so run them once in a sandbox
against a staging deployment, confirm a test card upgrades an account, then
repeat them in live. Switch environments with the picker in the top-left of the
dashboard; live mode additionally needs your business details submitted and
approved before it can charge anyone.

To skip Stripe entirely in development, set `BILLING_PROVIDER=mock` — an
in-memory adapter with no network calls, which is what dev and e2e use.

## 1. Create the product catalog

Three paid tiers need a product and a **recurring** price. (Free has no price;
it's what an account falls back to.)

For each of **Fresh**, **Pro**, and **Max**:

1. **Product catalog → Add product**.
2. **Name** it `Slide Machine Fresh` (then `… Pro`, `… Max`). The name is what
   the customer sees at checkout and on their receipt. Description optional.
3. Under **Pricing**: **Recurring**, billing period **Monthly**, and the amount
   — `19`, `99`, `299` USD respectively ([BILLING_COST_MODEL.md
   §8](BILLING_COST_MODEL.md) derives these from service costs; change them
   there first if you change them here).
4. **Save**, then open the product and copy its **price id** — it starts with
   `price_`, e.g. `price_1U0P1qB5UeQhNCWrLlKbcC5R`.

**Copy the price id, not the product id.** The product page shows both;
`prod_…` is the wrong one and checkout will reject it.

The price must be recurring — the app creates subscriptions, so a one-time
price fails at checkout and is silently dropped from the pricing table.
Currency is yours to choose; the page displays whatever Stripe reports.

## 2. Put the price ids into the plan config

Edit [config/plans.json](../config/plans.json) — `priceId` on each tier:

```json
{
  "free": { "priceId": null, ... },
  "fresh": { "priceId": "price_…", ... },
  "pro":   { "priceId": "price_…", ... },
  "max":   { "priceId": "price_…", ... }
}
```

A tier with `priceId: null` is not for sale: its upgrade button doesn't appear
and checkout refuses it. That is correct for Free and a way to withdraw a tier
from sale without deleting it.

This file is baked into the container image, so **committing and pushing it
redeploys the app** — it is not an environment variable and cannot be changed
from the DO dashboard. Caps and retention live in the same file
([ADMINISTRATION.md](ADMINISTRATION.md#plans-and-usage-caps)).

Because a sandbox and live catalog have different ids, the file holds one set
at a time — whichever matches the key the deployment is running with.

## 3. Create the API key

1. **Developers → API keys**.
2. Copy the **Secret key** (`sk_live_…` in live, `sk_test_…` in a sandbox).
   It's shown once; treat it like a password and never put it in the client or
   in git.

The publishable key is not used — checkout is hosted, so nothing Stripe-related
ships in the browser bundle.

Optionally use a **restricted key** instead, with write on *Checkout Sessions*,
*Subscriptions*, and *Customer portal*, and read on *Prices* and *Customers*.
Those are every call the adapter makes.

## 4. Create the webhook endpoint

A completed payment only becomes a plan change when the webhook lands — the
browser returning from Stripe grants nothing, so that a user who closes the tab
mid-redirect still gets what they paid for.

1. **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL**: `https://<your-app-domain>/api/billing/webhook` — the same
   host as `PUBLIC_BASE_URL`.
3. **Select events** — exactly these three:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. **Add endpoint**, then reveal and copy the **Signing secret** (`whsec_…`).

Those three carry every state the app acts on: a new subscription, a status or
tier change (including a failed payment going past-due and a cancel-at-period-
end), and an ended subscription. Invoice and checkout-session events add
nothing — a failed charge already arrives as a subscription update — and
anything else is verified, ignored, and acknowledged.

The signing secret is **per endpoint**, so the sandbox and live endpoints have
different ones. A mismatch fails signature verification and every delivery is
rejected before it's read.

## 5. Turn on the customer portal

**Settings → Billing → Customer portal**, then save a configuration once per
environment (defaults are fine). Allow customers to update payment methods,
switch plans, and cancel — that is what the app's *Manage plan* button opens.
Without a saved configuration Stripe rejects the request and the button errors.

## 6. Environment variables

Set these on the App Platform `web` component (dashboard → app → Settings →
Environment Variables), alongside the rest of
[DEPLOY.md §5](DEPLOY.md#5-environment-variables). Changing them redeploys the
app.

| Variable | Type | Value |
| --- | --- | --- |
| `BILLING_PROVIDER` | plain | `stripe` |
| `STRIPE_SECRET_KEY` | **secret** | the key from §3 (`sk_live_…` / `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | **secret** | the signing secret from §4 (`whsec_…`) |
| `PUBLIC_BASE_URL` | plain | already set for the deployment; checkout builds its return URLs from it, so billing fails without it |

Mark both Stripe values **Encrypted** — an App Platform variable declared with
no type is stored and displayed in plain text. A variable that exists but is
empty counts as unset.

Nothing goes in the client's environment; `VITE_STRIPE_PUBLISHABLE_KEY` in
[client/.env.example](../client/.env.example) is a leftover and stays commented
out.

## 7. Check it works

1. Open `/app/plans` signed in. Every paid tier should show a **price** — if
   the amounts are missing but the buttons are there, the key is wrong or
   unset, and Stripe is being asked for prices it won't return.
2. Click **Upgrade**. You should land on a Stripe-hosted checkout page.
3. Pay. In a sandbox use card `4242 4242 4242 4242`, any future expiry, any
   CVC, any postal code. (Real cards only work in live; test cards are declined
   there.)
4. Back in the app, the account's plan should read the new tier within a second
   or two. If it doesn't, the payment worked and the webhook didn't — check
   **Developers → Webhooks → your endpoint** for the delivery and its response.
5. **Manage plan** should open the Stripe portal.

## 8. When it fails

The UI shows one generic message for every billing failure, so read the actual
reason in the browser's network tab — the `POST /api/actions/billing.checkout`
response body carries it.

| Message in the response | Cause |
| --- | --- |
| `Billing is not configured` | `STRIPE_SECRET_KEY` unset or empty |
| `…rejected the request (400)… No such price` | the price id belongs to the other environment or another Stripe account, or was deleted |
| `The <tier> plan cannot be purchased here` | that tier's `priceId` is `null` in `config/plans.json` |
| `Plan "<tier>" has no billing price configured` | same, reached from a plan change rather than checkout |
| `Billing is not configured: the application has no public URL` | `PUBLIC_BASE_URL` unset |
| `This account has no billing record to manage yet` | the portal was opened for an account that has never checked out |

Two failures show up elsewhere instead:

- **Prices missing from the pricing table, buttons still present.** Reading a
  price is allowed to fail quietly so the page still loads. The cause is the
  same as a `Billing is not configured` checkout.
- **Payment succeeded, plan still Free.** The webhook never arrived or never
  verified. Stripe's endpoint page shows each delivery and the app's reply;
  `400` there means the signing secret doesn't match, and no deliveries at all
  means the URL or the event selection is wrong.

Prices are cached for five minutes, so an amount edited in Stripe reaches the
pricing page within that window without a deploy. Stripe amounts are immutable
— "changing a price" means creating a new one and putting its id in
`config/plans.json`, which is a code change and a redeploy. Existing
subscribers stay on the price they signed up at until their subscription is
moved.

## Reference

- What the tiers mean: [SPEC BILL-1](SPEC.md#bill-1-subscription-tiers) /
  [BILL-2](SPEC.md#bill-2-billing-provider-stripe-integration) /
  [BILL-6](SPEC.md#bill-6-configurable-pricing--caps)
- Why there's no Stripe SDK, and how another provider would slot in:
  [DECISIONS.md](DECISIONS.md#billing-abstraction-one-adapter-seam-no-vendor-sdk-2026-07-31), [TECH-9](SPEC.md#tech-9-billing-provider-abstraction-layer)
- The adapter itself: [server/src/billing/stripe.ts](../server/src/billing/stripe.ts)
- Caps, prices, and the arithmetic behind them:
  [BILLING_COST_MODEL.md](BILLING_COST_MODEL.md)
