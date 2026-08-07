/**
 * P-8 as executable assertions.
 *
 * P-8 is a standing property, not a feature — "the app stores no raw card
 * data; provider webhooks are signature-verified; only minimal,
 * provider-neutral references are stored". Nothing about it is visible in a
 * feature test, which means nothing about it fails when someone breaks it.
 * These are the tests that fail instead.
 *
 * They are deliberately written against the *shapes* — the persisted schema,
 * the wire DTOs, the verification path — rather than against a scenario, so
 * they keep holding as the features around them change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'

const SECRET = 'whsec_test_secret'

// Mocked rather than read from the environment so the "no secret configured"
// case is reachable — that is the case worth testing, and a real .env cannot
// express it without breaking every other file in the run.
const testEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as string,
  BILLING_PROVIDER: 'stripe' as string,
  STRIPE_SECRET_KEY: 'sk_test_123' as string | undefined,
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' as string | undefined,
  // The real plans file, so the mock adapter's tier lookup resolves.
  PLANS_CONFIG_PATH: new URL('../../../config/plans.json', import.meta.url)
    .pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

const { verifySignature } = await import('./stripe')

const here = import.meta.dirname

beforeEach(() => {
  testEnv.STRIPE_WEBHOOK_SECRET = SECRET
  testEnv.NODE_ENV = 'test'
})

describe('P-8: no raw card data is stored', () => {
  /**
   * Words that only appear in code that is touching a payment instrument. The
   * app never sees one — the provider is the system of record — so any of
   * these turning up in a persisted schema means something has started
   * handling what it must not.
   */
  const CARD_FIELDS =
    /\b(cardNumber|card_number|cvv|cvc|securityCode|expMonth|exp_month|expYear|exp_year|last4|primaryAccountNumber)\b/i

  it.each([
    ['subscription', '../models/subscription.ts'],
    ['user', '../models/user.ts'],
  ])('keeps the %s schema free of payment-instrument fields', (_name, file) => {
    const source = readFileSync(join(here, file), 'utf8')
    expect(source).not.toMatch(CARD_FIELDS)
  })

  it('stores only opaque, provider-neutral references on a subscription', () => {
    const source = readFileSync(join(here, '../models/subscription.ts'), 'utf8')
    // The discriminator plus two opaque ids (TECH-9). Naming the vendor in a
    // field would be the first step back towards a schema migration per
    // provider — and towards storing whatever that vendor happens to hand us.
    expect(source).toContain('billingProvider')
    expect(source).toContain('billingCustomerId')
    expect(source).toContain('providerSubscriptionId')
    // Not a mention of the vendor anywhere in what we persist: the moment a
    // field is named for one, switching providers stops being an adapter
    // change and becomes a migration.
    expect(source).not.toMatch(/stripe/i)
  })
})

describe('P-8: no provider reference reaches the client', () => {
  /**
   * The account's Plan view is the one client surface that reads billing
   * state. It carries a tier, a status, two dates and a boolean — nothing a
   * vendor issued. This is what keeps "swap the provider" an adapter change
   * (TECH-9) and keeps customer references server-side.
   */
  it('keeps customer and subscription ids out of the billing DTOs', () => {
    const source = readFileSync(
      join(here, '../../../shared/src/dto/billing.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/billingCustomerId|providerSubscriptionId/)
    // The plan catalog sends `purchasable: boolean` and a price, never the
    // vendor's price id that produced them — the same discipline one level
    // down from the subscription itself.
    expect(source).not.toMatch(/priceId/)
    // What the account *can do* is expressed as capability, not as the
    // presence of a vendor reference the client would have to interpret.
    expect(source).toMatch(/canManageBilling/)
  })

  it('keeps the customer reference off the account DTO too', () => {
    // The billing DTOs were careful about this from the start; the *user* DTO
    // was not, and shipped `billingCustomerId` on every auth response to a
    // client that never read it. Two places send account data, so both have
    // to be checked.
    const source = readFileSync(join(here, '../models/user.ts'), 'utf8')
    const dto = source.slice(source.indexOf('export const toUserDto'))
    expect(dto).not.toMatch(/billingCustomerId:/)
    // The discriminator stays: it names an adapter, not a person, and the
    // admin console reports it.
    expect(dto).toMatch(/billingProvider:/)
  })
})

describe('P-8: webhooks are signature-verified', () => {
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.updated',
  })

  /** A correctly signed header for `raw`, as Stripe would send it. */
  const sign = (raw: string, at = Math.floor(Date.now() / 1000)): string => {
    const mac = createHmac('sha256', SECRET)
      .update(`${at}.${raw}`)
      .digest('hex')
    return `t=${at},v1=${mac}`
  }

  it('accepts a correctly signed, fresh delivery', () => {
    expect(() => verifySignature(body, sign(body))).not.toThrow()
  })

  it.each([
    ['no signature at all', undefined],
    ['a malformed header', 'not-a-signature'],
    ['a header with no v1 component', 't=1234'],
    [
      'a v1 that is not the right hmac',
      `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    ],
  ])('rejects %s', (_name, header) => {
    expect(() => verifySignature(body, header)).toThrow()
  })

  it('rejects a signature computed over different bytes', () => {
    // The exact case a re-serializing body parser would create, and the
    // reason the route is mounted ahead of express.json.
    expect(() => verifySignature(`${body} `, sign(body))).toThrow()
  })

  it('rejects a valid signature that is too old to be fresh', () => {
    // Replay: the payload and its signature are genuine, and that is not
    // enough — a delivery captured once must not work forever.
    const longAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24
    expect(() => verifySignature(body, sign(body, longAgo))).toThrow()
  })

  it('fails closed when no endpoint secret is configured', () => {
    // Unverifiable is refused, never waved through: a deployment that forgot
    // the secret rejects billing events rather than believing them.
    testEnv.STRIPE_WEBHOOK_SECRET = undefined
    expect(() => verifySignature(body, sign(body))).toThrow()
  })
})

describe('P-8: the unsigned adapter cannot serve production', () => {
  /**
   * The mock adapter parses webhooks without a signature — by design, and
   * harmlessly, until the day something runs it in production. Then the
   * unauthenticated webhook route becomes "POST this JSON to put any account
   * on any plan". Two independent locks stop that; both are tested, because a
   * defence that only exists in one place is one refactor from not existing.
   */
  it('refuses to parse a delivery when NODE_ENV is production', async () => {
    const { MockBillingProvider } = await import('./mock')
    testEnv.NODE_ENV = 'production'
    await expect(
      new MockBillingProvider().parseWebhook({
        rawBody: JSON.stringify({
          type: 'subscription.active',
          subscription: { userId: 'victim', tier: 'max' },
        }),
        headers: {},
      }),
    ).rejects.toThrow(/not usable in production/i)
  })

  it('still parses a delivery outside production', async () => {
    const { MockBillingProvider } = await import('./mock')
    const event = await new MockBillingProvider().parseWebhook({
      rawBody: JSON.stringify({
        type: 'subscription.active',
        subscription: { userId: 'u1', tier: 'pro' },
      }),
      headers: {},
    })
    expect(event?.type).toBe('subscription.active')
  })

  // The other lock — configuration refusing to boot at all — is in
  // config/env.test.ts, where parseEnv is exercised unmocked.
})
