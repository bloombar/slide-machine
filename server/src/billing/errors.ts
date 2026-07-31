/**
 * Billing-layer errors (TECH-9). Kept free of Express and of any vendor SDK
 * so adapters can throw them and the HTTP layer maps them to responses.
 */

/**
 * The billing provider could not fulfil a request — misconfigured, rejected
 * the call, or is transiently unavailable. The `message` is user-facing;
 * `retryable` separates a transient outage from a permanent rejection.
 */
export class BillingUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'BillingUnavailableError'
  }
}

/**
 * A webhook delivery failed verification: missing/malformed signature, wrong
 * secret, or a timestamp outside the replay window. Always a 400 — never
 * treated as an event to act on.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}
