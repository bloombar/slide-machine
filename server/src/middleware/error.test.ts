/**
 * Unit tests for the error → status/code mapping.
 *
 * The codes are a contract with the client (client/src/i18n/apiError.ts), so
 * the point here is less the status than the code: several refusals share 403
 * and the client tells them apart by code alone.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { errorHandler, HttpError } from './error'
import {
  ActionForbiddenError,
  CapabilityRequiredError,
  EmailUnverifiedError,
  ActionNotFoundError,
  ActionValidationError,
} from '../actions/dispatch'

/** Captures what the handler wrote. */
const handle = (err: unknown) => {
  const json = vi.fn()
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response
  errorHandler(err, {} as Request, res, vi.fn())
  return {
    status: (res.status as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as number,
    body: json.mock.calls[0]![0] as {
      error: { code: string; message: string; details?: string[] }
    },
  }
}

describe('errorHandler', () => {
  it('maps a validation error to 400 invalid_input with its issues', () => {
    const res = handle(new ActionValidationError('slide.editContent', ['bad']))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(res.body.error.details).toEqual(['bad'])
  })

  it('maps a forbidden action to 403 forbidden', () => {
    const res = handle(new ActionForbiddenError())
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  // Three refusals share 403; only the code separates them, which is what
  // lets the client offer a Connect button rather than a flat "no" (TECH-14).
  it('maps a missing capability to 403 capability_required, naming it', () => {
    const res = handle(new CapabilityRequiredError('google-drive'))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('capability_required')
    expect(res.body.error.details).toEqual(['google-drive'])
  })

  it('keeps capability_required distinct from a plain forbidden', () => {
    expect(
      handle(new CapabilityRequiredError('google-drive')).body.error.code,
    ).not.toBe(handle(new ActionForbiddenError()).body.error.code)
  })

  it('maps an unconfirmed address to 403 email_unverified', () => {
    const res = handle(new EmailUnverifiedError())
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('email_unverified')
  })

  it('maps an unknown action to 404', () => {
    expect(handle(new ActionNotFoundError('nope.nothing')).status).toBe(404)
  })

  it('passes an HttpError through with its own status and code', () => {
    const res = handle(new HttpError(429, 'rate_limited', 'Slow down'))
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
  })

  it('reports anything unrecognized as a 500 without leaking it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = handle(new Error('mongo connection string: secret'))
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('internal_error')
    expect(res.body.error.message).not.toContain('secret')
  })
})
