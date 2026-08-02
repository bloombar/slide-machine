/**
 * Billing webhooks (SPEC BILL-2). The provider is the system of record for
 * billing state, and this is the only way it tells us: a payment succeeded, a
 * card failed, a subscription ended.
 *
 * Three rules the rest of the file follows:
 *
 * - **Unauthenticated, but not untrusted.** The caller is the payment
 *   provider, not a user, so there is no session to check. The signature over
 *   the raw body is what stands in for one, and it is verified inside the
 *   adapter before a single byte of the payload is believed (TECH-9).
 * - **Raw bytes, not parsed JSON.** Signatures cover the exact bytes sent, so
 *   this route is mounted ahead of the JSON body parser in app.ts. Parsing and
 *   re-serializing would change the message and fail every verification.
 * - **Answer 2xx unless we genuinely failed.** Providers retry anything else.
 *   An event we choose not to act on — an unrelated type, a duplicate, one
 *   naming an account that is not ours — is not a failure and must not be
 *   retried forever; only an unverifiable delivery is refused.
 */
import { Router } from 'express'
import type { IncomingHttpHeaders } from 'node:http'
import { billingRegistry } from '../billing/registry'
import { WebhookVerificationError } from '../billing/errors'
import { applyBillingEvent } from '../billing/subscription'

export const billingRouter = Router()

/** The path the raw-body parser is mounted on; app.ts must agree with it. */
export const WEBHOOK_PATH = '/billing/webhook'

/**
 * Node gives repeated headers as arrays; signature headers are single-valued,
 * so the first is taken rather than joining them into something that cannot
 * verify.
 */
const flatten = (
  headers: IncomingHttpHeaders,
): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  )

/** The delivery exactly as sent. A Buffer when the raw parser ran, which is
 * the only shape that can verify; the fallbacks keep the route honest if it is
 * ever mounted without it, and fail verification loudly rather than quietly. */
const rawBodyOf = (body: unknown): string => {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  return JSON.stringify(body ?? {})
}

billingRouter.post(WEBHOOK_PATH, async (req, res) => {
  const provider = billingRegistry.get()

  let event
  try {
    event = await provider.parseWebhook({
      rawBody: rawBodyOf(req.body),
      headers: flatten(req.headers),
    })
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      // 400, and nothing else: an unverified payload is not evidence of
      // anything, so it is neither applied nor described back to the sender.
      console.warn('Rejected billing webhook:', error.message)
      res.status(400).json({ error: { code: 'invalid_signature' } })
      return
    }
    throw error
  }

  // A verified event of a type we do not act on. Acknowledged so the provider
  // stops resending it.
  if (!event) {
    res.json({ received: true, applied: false })
    return
  }

  const result = await applyBillingEvent(event, provider.name)
  if (!result.applied) {
    console.info(
      `Billing event ${event.providerEventId || '(unidentified)'} not applied: ${result.reason}`,
    )
  }
  res.json({ received: true, applied: result.applied, reason: result.reason })
})
