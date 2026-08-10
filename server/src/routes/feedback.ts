/**
 * POST /api/feedback — the "Send feedback" page's one endpoint. It composes
 * the submission into an email, sends it to the address the server is
 * configured with (FEEDBACK_EMAIL), and stores nothing: the inbox is the
 * record, so there is no feedback table to secure, moderate, or purge.
 *
 * Open to anyone, because the form is on a public page and a visitor who
 * cannot get past a bug is exactly the person worth hearing from. Two
 * consequences follow, and both are handled here rather than assumed away:
 *
 *  - **It is rate limited per caller**, since an open endpoint that sends
 *    mail is otherwise a relay someone else can point at our inbox.
 *  - **Nothing in the message is trusted.** The sender's identity is taken
 *    from their access token when they have one, and the address they typed
 *    is quoted as a claim rather than presented as the sender.
 *
 * A signed-in sender is identified from the same Bearer token every other
 * route uses — but not *required* to be, so the handler verifies the token
 * itself instead of composing requireAuth.
 */
import { Router } from 'express'
import { z } from 'zod'
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackKind,
  type FeedbackResponse,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { verifyAccessToken } from '../auth/tokens'
import { HttpError } from '../middleware/error'
import { UserModel } from '../models/user'
import { createRateLimiter } from '../lib/rate-limit'
import { MailUnavailableError, sendMail } from '../lib/mailer'
import { feedbackEnabled } from '../lib/feedback-config'

export const feedbackRouter = Router()

/**
 * Whether the form can be offered at all. Defined in lib/feedback-config, which
 * the cap notification emails ask too; re-exported here because GET /api/config
 * and this route's own guards have always read it from this module.
 */
export { feedbackEnabled }

/** Submissions allowed per caller per window. Loose enough that nobody
 * filing three bugs in a row notices, tight enough that scripting it is
 * pointless. */
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 15 * 60 * 1000

const limiter = createRateLimiter({
  limit: RATE_LIMIT,
  windowMs: RATE_WINDOW_MS,
})

/** Test seam: each case starts with a fresh window. */
export const resetFeedbackRateLimit = (): void => limiter.reset()

const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  subject: z.string().trim().min(1, 'A summary is required').max(200),
  message: z
    .string()
    .trim()
    .min(1, 'A message is required')
    .max(FEEDBACK_MESSAGE_MAX, 'That message is too long'),
  // Blank is not "invalid" — it is an anonymous sender declining to leave a
  // way back — so the empty string is normalized away before the email check.
  email: z
    .string()
    .trim()
    .transform(value => value || undefined)
    .pipe(z.email('That email address is not valid').optional())
    .optional(),
  page: z.string().trim().max(500).optional(),
})

/** How each kind reads in the subject line of the email. */
const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: 'Bug report',
  feature: 'Feature request',
  other: 'Feedback',
}

/** The signed-in sender, when there is one. Anything wrong with the token —
 * absent, expired, pointing at a deleted account — simply makes this an
 * anonymous submission; it is never a reason to refuse the message. */
const senderFrom = async (
  header: string | undefined,
): Promise<{ id: string; email: string; displayName: string } | null> => {
  if (!header?.startsWith('Bearer ')) return null
  try {
    const { userId } = await verifyAccessToken(header.slice('Bearer '.length))
    const user = await UserModel.findById(userId).select('email displayName')
    return user
      ? { id: userId, email: user.email, displayName: user.displayName }
      : null
  } catch {
    return null
  }
}

/**
 * The email body: who it is from, where they were, then what they wrote.
 * The account line is what the server knows; the "reply to" line is what the
 * sender typed, and says so — an unauthenticated form can claim any address.
 */
const composeBody = (
  input: z.infer<typeof feedbackSchema>,
  sender: { id: string; email: string; displayName: string } | null,
): string => {
  const lines = [
    `Type: ${KIND_LABEL[input.kind]}`,
    sender
      ? `Account: ${sender.displayName} <${sender.email}> (id ${sender.id})`
      : 'Account: not signed in',
  ]
  if (input.email) lines.push(`Reply-to address given: ${input.email}`)
  if (input.page) lines.push(`Page: ${input.page}`)
  return `${lines.join('\n')}\n\n${input.message}\n`
}

/** Parses a request body or throws a 400 with per-field details. */
const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body)
  if (!result.success) {
    const details = result.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`,
    )
    throw new HttpError(400, 'invalid_input', 'Invalid request', details)
  }
  return result.data
}

feedbackRouter.post('/feedback', async (req, res) => {
  if (!feedbackEnabled()) {
    throw new HttpError(
      503,
      'feedback_unavailable',
      'Feedback is not set up on this server',
    )
  }
  // Keyed on the caller's address. Behind a proxy that is the proxy's, which
  // makes the limit shared rather than per-visitor — stricter than intended,
  // never looser, which is the right way for a nuisance guard to be wrong.
  if (!limiter.take(req.ip ?? 'unknown')) {
    throw new HttpError(
      429,
      'too_many_requests',
      'Too many messages just now — please try again in a little while',
    )
  }

  const input = parseBody(feedbackSchema, req.body)
  const sender = await senderFrom(req.headers.authorization)

  try {
    await sendMail({
      to: env.FEEDBACK_EMAIL!,
      subject: `[Slide Machine] ${KIND_LABEL[input.kind]}: ${input.subject}`,
      text: composeBody(input, sender),
      // A signed-in sender's account address is the one the server can
      // vouch for, so it wins over anything typed into the form.
      replyTo: sender?.email ?? input.email,
    })
  } catch (error) {
    // The message is gone the moment this handler returns, so whatever went
    // wrong, it goes to the log before the caller is told. Losing someone's
    // bug report to a relay outage is worse than a noisy log line.
    console.error('Feedback could not be sent:', error)
    console.error(composeBody(input, sender))
    throw new HttpError(
      503,
      'feedback_unavailable',
      error instanceof MailUnavailableError
        ? 'Feedback is not set up on this server'
        : 'Your message could not be sent — please try again later',
    )
  }

  const body: FeedbackResponse = { sent: true }
  res.status(202).json(body)
})
