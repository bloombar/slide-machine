/**
 * Unit tests for model-legible dispatch errors (docs/MCP.md §3.3).
 *
 * The distinctions being tested are behavioural, not cosmetic: a model that
 * cannot tell "wait and retry" from "this will never work" either loops on a
 * settled refusal or abandons one the user could clear in ten seconds. So each
 * case asserts the verdict, the code, and the one fact the model needs to act.
 */
import { describe, expect, it } from 'vitest'
import { describeErrorForAgent } from './agent-error'
import {
  ActionForbiddenError,
  ActionNotFoundError,
  ActionValidationError,
  CapabilityRequiredError,
  EmailUnverifiedError,
} from './dispatch'
import { PlanLimitExceededError } from '../billing/limits'
import { BillingUnavailableError } from '../billing/errors'
import { GenerationUnavailableError } from '../providers/errors'

describe('describeErrorForAgent', () => {
  it('hands back the rejected fields so the call can be corrected', () => {
    const result = describeErrorForAgent(
      new ActionValidationError('slide.editContent', [
        'slideId: Too small: expected string to have >=1 characters',
      ]),
    )
    expect(result.code).toBe('invalid_input')
    expect(result.message).toContain('slideId')
    expect(result.retryable).toBe(false)
  })

  it('says an unconfirmed address is the account holder’s to fix', () => {
    const result = describeErrorForAgent(new EmailUnverifiedError())
    expect(result.code).toBe('email_unverified')
    expect(result.message).toContain('confirm')
    expect(result.retryable).toBe(false)
  })

  it('names the account the user has to connect', () => {
    const result = describeErrorForAgent(
      new CapabilityRequiredError('google-drive'),
    )
    expect(result.code).toBe('capability_required')
    expect(result.message).toContain('google-drive')
    expect(result.retryable).toBe(false)
  })

  it('keeps missing and forbidden indistinguishable, as the policy layer does', () => {
    const result = describeErrorForAgent(new ActionForbiddenError())
    expect(result.code).toBe('forbidden')
    // Resolving the ambiguity here would undo the reason it exists: an id
    // must not be probeable for whether the thing behind it is real.
    expect(result.message).toContain('either it does not exist')
    expect(result.retryable).toBe(false)
  })

  it('tells a model that invented a tool name to stop inventing them', () => {
    const result = describeErrorForAgent(new ActionNotFoundError('deck.magic'))
    expect(result.code).toBe('unknown_action')
    expect(result.message).toContain('deck.magic')
    expect(result.retryable).toBe(false)
  })

  it('reports an exhausted allowance with the numbers, and as settled', () => {
    const result = describeErrorForAgent(
      new PlanLimitExceededError('sttMinutes', 120, 120),
    )
    expect(result.code).toBe('plan_limit_exceeded')
    expect(result.message).toContain('sttMinutes')
    expect(result.message).toContain('120 of 120')
    expect(result.retryable).toBe(false)
  })

  it('passes a billing outage’s own verdict through in both directions', () => {
    expect(
      describeErrorForAgent(new BillingUnavailableError('rate limited', true)),
    ).toMatchObject({ code: 'billing_unavailable', retryable: true })
    expect(
      describeErrorForAgent(new BillingUnavailableError('bad card', false)),
    ).toMatchObject({ code: 'billing_unavailable', retryable: false })
  })

  it('passes a generation outage’s own verdict through in both directions', () => {
    expect(
      describeErrorForAgent(new GenerationUnavailableError('overloaded', true)),
    ).toMatchObject({ code: 'generation_unavailable', retryable: true })
    expect(
      describeErrorForAgent(new GenerationUnavailableError('no quota', false)),
    ).toMatchObject({ code: 'generation_unavailable', retryable: false })
  })

  it('says nothing about an unrecognised throw beyond that it failed', () => {
    const result = describeErrorForAgent(
      new Error('ECONNREFUSED mongodb://user:hunter2@10.0.0.4:27017'),
    )
    expect(result.code).toBe('internal_error')
    // The text reaches a third-party assistant, so an internal detail must
    // not ride along with it.
    expect(result.message).not.toContain('hunter2')
    expect(result.message).not.toContain('ECONNREFUSED')
    expect(result.retryable).toBe(true)
  })
})
