/**
 * Action dispatcher (SPEC TECH-13). Runs the validate → authorize → meter →
 * execute pipeline for a named action. Errors are typed so the HTTP layer
 * can map them to status codes (400 / 403 / 402) uniformly.
 */
import type { Action } from './define'
import type { ActionContext } from './context'
import { runWithUsage } from '../billing/usage-context'

export class ActionNotFoundError extends Error {
  constructor(name: string) {
    super(`Unknown action "${name}"`)
    this.name = 'ActionNotFoundError'
  }
}

export class ActionForbiddenError extends Error {
  constructor(message = 'You do not have access to this resource') {
    super(message)
    this.name = 'ActionForbiddenError'
  }
}

/**
 * The account has not confirmed its email address, and the thing it asked for
 * needs that (AUTH-3). Its own class, not a plain forbidden, because the user
 * can fix it themselves — the client turns this into "confirm your address"
 * with a resend button rather than a flat refusal.
 */
export class EmailUnverifiedError extends Error {
  constructor(
    message = 'Confirm your email address before publishing publicly',
  ) {
    super(message)
    this.name = 'EmailUnverifiedError'
  }
}

export class ActionValidationError extends Error {
  constructor(
    actionName: string,
    public readonly issues: string[],
  ) {
    super(`Invalid input for action "${actionName}": ${issues.join('; ')}`)
    this.name = 'ActionValidationError'
  }
}

const actions = new Map<string, Action<unknown, unknown>>()

/** Registers an action under its name; last registration wins (useful in tests). */
export const registerAction = <I, O>(action: Action<I, O>): void => {
  actions.set(action.name, action as Action<unknown, unknown>)
}

/**
 * Dispatches a named action with raw (untrusted) input through the full
 * pipeline and returns its result.
 */
export const dispatch = async <O = unknown>(
  name: string,
  rawInput: unknown,
  ctx: ActionContext,
): Promise<O> => {
  const action = actions.get(name)
  if (!action) throw new ActionNotFoundError(name)

  const parsed = action.input.safeParse(rawInput)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`,
    )
    throw new ActionValidationError(name, issues)
  }

  await action.authorize?.(ctx, parsed.data)
  await action.meter?.(ctx, parsed.data)

  // Everything the action does — including provider calls several layers down —
  // is attributed to the acting user, so adapters can meter what they spend
  // without taking a userId through the vendor-neutral interfaces (BILL-3).
  //
  // Payer and actor are the same person here, and saying so explicitly is what
  // lets the cost ledger separate an instructor's own spend from their
  // audience's (BILL-7). The paths where they differ — a viewer's playback
  // charged to a deck's owner — set their own attribution.
  const run = () => action.execute(ctx, parsed.data) as Promise<O>
  return ctx.userId
    ? runWithUsage({ userId: ctx.userId, actorId: ctx.userId }, run)
    : run()
}
