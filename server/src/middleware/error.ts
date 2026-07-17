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
  ActionNotFoundError,
  ActionValidationError,
} from '../actions/dispatch'
import { GenerationUnavailableError } from '../providers/errors'

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
  } else if (err instanceof ActionForbiddenError) {
    res.status(403).json(body('forbidden', err.message))
  } else if (err instanceof ActionNotFoundError) {
    res.status(404).json(body('unknown_action', err.message))
  } else if (err instanceof GenerationUnavailableError) {
    // 503: an upstream AI provider is out of quota/credits or overloaded.
    res.status(503).json(body('generation_unavailable', err.message))
  } else {
    console.error('Unhandled error:', err)
    res.status(500).json(body('internal_error', 'Something went wrong'))
  }
}
