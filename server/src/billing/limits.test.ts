/**
 * Unit tests for the plan-limit error. Its message is shown to whoever hit the
 * wall — including a student on someone else's deck — so the default must not
 * mention billing, plans, or the owner.
 */
import { describe, it, expect } from 'vitest'
import { PlanLimitExceededError } from './limits'

describe('PlanLimitExceededError', () => {
  it('carries the metric, cap, and usage for the caller to act on', () => {
    const error = new PlanLimitExceededError('aiTokens', 1000, 1200)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PlanLimitExceededError')
    expect(error.metric).toBe('aiTokens')
    expect(error.cap).toBe(1000)
    expect(error.used).toBe(1200)
  })

  it('defaults to a message safe for a viewer to read', () => {
    const error = new PlanLimitExceededError('audienceLocales', 3, 3)

    expect(error.message).toBe('This action is unavailable right now.')
    expect(error.message).not.toMatch(/plan|billing|upgrade|owner|instructor/i)
  })

  it('takes an owner-facing message when the caller is the account holder', () => {
    const error = new PlanLimitExceededError(
      'aiTokens',
      1000,
      1000,
      'You have used all of this period’s AI generation.',
    )

    expect(error.message).toMatch(/AI generation/)
  })
})
