/**
 * Whether the feedback form can be offered at all: mail has to be deliverable
 * and there has to be somewhere to deliver it.
 *
 * It lives here rather than beside the route because two unrelated callers ask
 * it — the route itself (and GET /api/config through it, so the client can
 * hide the page's entry point), and the cap notification emails, which invite
 * a Max account to get in touch and should only carry the link when the form
 * behind it can send. A service reaching into a route module to ask would be
 * the wrong way round, and asking it twice in two places would let the two
 * answers drift.
 */
import { mailerAvailable } from './mailer'
import { env } from '../config/env'

export const feedbackEnabled = (): boolean =>
  mailerAvailable() && Boolean(env.FEEDBACK_EMAIL)
