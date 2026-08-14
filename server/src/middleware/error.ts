/**
 * Central error handling. Routes and services throw typed errors; this
 * 4-arg handler (must be registered after all routes — Express 5 forwards
 * rejected async handlers here automatically) maps them to statuses and
 * the shared ApiErrorBody shape.
 */
import type { NextFunction, Request, Response } from 'express'
import type { ApiErrorBody } from '@slide-machine/shared'
import {
  ActionForbiddenError,
  CapabilityRequiredError,
  EmailUnverifiedError,
  ActionNotFoundError,
  ActionValidationError,
} from '../actions/dispatch'
import { GenerationUnavailableError } from '../providers/errors'
import { PlanLimitExceededError } from '../billing/limits'
import { BillingUnavailableError } from '../billing/errors'
import { PresentationUnreadableError } from '../import/read-slides'
import { DriveFileUnreadableError } from '../lib/drive-file'

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[],
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const body = (
  code: string,
  message: string,
  details?: string[],
): ApiErrorBody => ({
  error: { code, message, details },
})

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code, err.message, err.details))
  } else if (err instanceof ActionValidationError) {
    res.status(400).json(body('invalid_input', err.message, err.issues))
  } else if (err instanceof EmailUnverifiedError) {
    // 403 with a code of its own: the user can lift this themselves by
    // confirming their address (AUTH-3), so the client offers that rather
    // than reporting a flat refusal.
    res.status(403).json(body('email_unverified', err.message))
  } else if (err instanceof CapabilityRequiredError) {
    // 403 with a code of its own, checked before the plain forbidden below:
    // the caller may touch the thing, their account is just not equipped for
    // this (TECH-14). Like email_unverified, something they can fix — so the
    // client offers a Connect button rather than reporting a refusal.
    res
      .status(403)
      .json(body('capability_required', err.message, [err.capability]))
  } else if (err instanceof ActionForbiddenError) {
    res.status(403).json(body('forbidden', err.message))
  } else if (err instanceof ActionNotFoundError) {
    res.status(404).json(body('unknown_action', err.message))
  } else if (err instanceof PlanLimitExceededError) {
    // 402: a plan cap is exhausted. The operation did not run, so nothing was
    // billed past the plan — there is no overage path (BILL-4). `metric` lets
    // the client name the right upgrade prompt without parsing the message.
    res.status(402).json(body('plan_limit_exceeded', err.message, [err.metric]))
  } else if (err instanceof BillingUnavailableError) {
    // The billing provider could not serve the request (BILL-2). Retryable
    // means an outage or a rate limit, which will pass — 503, and the client
    // may offer to try again. Anything else is a rejection that will repeat
    // exactly the same way, so it is reported as a bad request instead of
    // inviting the user to keep pressing the button.
    res
      .status(err.retryable ? 503 : 400)
      .json(body('billing_unavailable', err.message))
  } else if (
    err instanceof PresentationUnreadableError ||
    err instanceof DriveFileUnreadableError
  ) {
    // A file in the user's Drive that we could not read (TMPL-8/EXP-3/EXP-5).
    //
    // These carry the one thing the instructor needs — whether reconnecting
    // would help — and until this branch existed they fell through to a plain
    // 500 "Something went wrong", which threw that away. The result was an
    // import that failed with nothing to act on, and a Connect button that
    // never appeared because the client had no way to tell the cases apart.
    //
    // `reconnect` becomes the same 403 + code a missing capability uses, so
    // the client offers the step; anything else is a rejection that will
    // repeat identically, reported as a bad request rather than inviting the
    // user to keep pressing the button.
    const [status, code] = err.reconnect
      ? ([403, 'google_reconnect'] as const)
      : err.notFound
        ? ([404, 'source_not_found'] as const)
        : ([400, 'source_unreadable'] as const)
    res.status(status).json(body(code, err.message))
  } else if (err instanceof GenerationUnavailableError) {
    // 503: an upstream AI provider is out of quota/credits or overloaded.
    res.status(503).json(body('generation_unavailable', err.message))
  } else {
    console.error('Unhandled error:', err)
    res.status(500).json(body('internal_error', 'Something went wrong'))
  }
}
