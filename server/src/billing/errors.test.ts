/**
 * Unit tests for the billing errors: both carry their name so the HTTP layer
 * can branch on it, and retryability rides along with the unavailable case.
 */
import { describe, it, expect } from 'vitest'
import { BillingUnavailableError, WebhookVerificationError } from './errors'

describe('BillingUnavailableError', () => {
  it('carries a user-facing message and its retryability', () => {
    const error = new BillingUnavailableError('Billing is busy', true)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BillingUnavailableError')
    expect(error.message).toBe('Billing is busy')
    expect(error.retryable).toBe(true)
  })
})

describe('WebhookVerificationError', () => {
  it('is a named error', () => {
    const error = new WebhookVerificationError('Missing webhook signature')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WebhookVerificationError')
    expect(error.message).toBe('Missing webhook signature')
  })
})
