/**
 * Turning a dispatch failure into something a language model can act on
 * (docs/MCP.md §3.3).
 *
 * The typed errors the action layer throws already draw the right
 * distinctions — a refusal the caller can lift by confirming their address is
 * not the same as one they cannot lift at all. What they are shaped for is a
 * user interface: `middleware/error.ts` maps each to a status code and a
 * short string, and the React client turns the code into a translated sentence
 * with a button next to it.
 *
 * An AI channel has no button. What it needs is the same distinction stated in
 * prose — what went wrong, whose problem it is, and whether calling again
 * could possibly work — because the alternative is a model that retries a
 * permanent refusal in a loop, or gives up on one a single confirmation would
 * have cleared.
 *
 * The codes are deliberately the same vocabulary the HTTP layer uses, so a
 * code means one thing across the application rather than one thing per
 * channel.
 */
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

/** A failure, described for a model rather than rendered for a person. */
export interface AgentError {
  /** Stable machine code, shared with the HTTP error vocabulary. */
  code: string
  /** What happened and what to do about it, in prose. */
  message: string
  /**
   * Whether making the same call again could plausibly succeed. False means
   * the failure is settled — retrying is wasted turns, and the model should
   * either change the call or tell the user what they have to do.
   */
  retryable: boolean
}

/**
 * The catch-all. Deliberately says nothing about the underlying error: an
 * unrecognised throw is as likely to carry an internal detail as anything
 * useful, and this text reaches a third-party assistant.
 */
const INTERNAL: AgentError = {
  code: 'internal_error',
  message:
    'Something went wrong on the server and the operation did not run. ' +
    'Nothing was changed. Trying once more is reasonable; if it fails again, ' +
    'tell the user rather than continuing to retry.',
  retryable: true,
}

/** Describes a thrown dispatch error in terms an AI channel can act on. */
export const describeErrorForAgent = (err: unknown): AgentError => {
  if (err instanceof ActionValidationError) {
    return {
      code: 'invalid_input',
      // The issues are the whole value here: they name the field and say what
      // was wrong with it, which is exactly what the model needs to fix the
      // call without guessing.
      message:
        `The arguments were rejected before anything ran: ${err.issues.join('; ')}. ` +
        'Correct the named fields and call again.',
      retryable: false,
    }
  }

  if (err instanceof EmailUnverifiedError) {
    return {
      code: 'email_unverified',
      message:
        'This needs a confirmed email address on the account, and the account ' +
        'does not have one yet. Only the account holder can do that — ask them ' +
        'to confirm their address in Slide Machine, then try again. Retrying ' +
        'now will fail the same way.',
      retryable: false,
    }
  }

  if (err instanceof CapabilityRequiredError) {
    // The capability is named rather than described, because the connect
    // screen the user has to visit is named after it too.
    return {
      code: 'capability_required',
      message:
        `This needs a connected "${err.capability}" account, and the account ` +
        'has not connected one. Only the account holder can connect it, from ' +
        'Settings in Slide Machine. Ask them to do that before trying again.',
      retryable: false,
    }
  }

  if (err instanceof ActionForbiddenError) {
    // The refusal is deliberately identical for "no such thing" and "not
    // yours", so that an id cannot be probed to learn which. The prose has to
    // preserve that ambiguity rather than resolve it helpfully.
    return {
      code: 'forbidden',
      message:
        'That is not available to this account: either it does not exist, or ' +
        'the account has no access to it. Check the id came from a listing this ' +
        'account can see. Do not retry with the same id.',
      retryable: false,
    }
  }

  if (err instanceof ActionNotFoundError) {
    return {
      code: 'unknown_action',
      message: `${err.message}. Use only the tools offered to you.`,
      retryable: false,
    }
  }

  if (err instanceof PlanLimitExceededError) {
    return {
      code: 'plan_limit_exceeded',
      message:
        `The account has used its ${err.metric} allowance for this billing ` +
        `period (${err.used} of ${err.cap}). The operation did not run and ` +
        'nothing was charged beyond the plan. This will not clear by retrying ' +
        '— the allowance resets at the end of the period, or the user can ' +
        'upgrade their plan.',
      retryable: false,
    }
  }

  // The two provider-outage errors carry their own verdict on whether waiting
  // helps, so it is passed through rather than guessed at.
  if (err instanceof BillingUnavailableError) {
    return {
      code: 'billing_unavailable',
      message: err.retryable
        ? `The billing service is temporarily unreachable (${err.message}). Nothing changed. Waiting and trying again may work.`
        : `The billing service rejected the request (${err.message}). Nothing changed, and retrying will be rejected identically.`,
      retryable: err.retryable,
    }
  }

  if (err instanceof GenerationUnavailableError) {
    return {
      code: 'generation_unavailable',
      message: err.retryable
        ? `The AI provider that generates slide content is temporarily unavailable (${err.message}). Nothing was generated. Waiting and trying again may work.`
        : `The AI provider that generates slide content refused the request (${err.message}). Nothing was generated, and retrying will fail the same way.`,
      retryable: err.retryable,
    }
  }

  return INTERNAL
}
