/**
 * Action dispatcher (SPEC TECH-13). Runs the validate → authorize → meter →
 * execute pipeline for a named action. Errors are typed so the HTTP layer
 * can map them to status codes (400 / 403 / 402) uniformly.
 */
import type { Action } from './define'
import type { ActionContext } from './context'
import { runWithUsage } from '../billing/usage-context'
import { entityFromInput } from '../billing/attribution-resolve'

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

/**
 * The caller may touch the resource, but their account lacks something the
 * operation needs — today, a connected Google account (EXP-4 / QUIZ-2). Its
 * own class, not a plain forbidden, because the user can fix it themselves:
 * the client offers a Connect button rather than reporting a refusal, exactly
 * as EmailUnverifiedError does for confirming an address.
 *
 * Before this existed the two were the same class with the same status, so a
 * client could only tell "not your lecture" from "connect an account" by
 * reading the message text.
 */
export class CapabilityRequiredError extends Error {
  constructor(
    public readonly capability: 'google-drive',
    message = 'Connect a Google account first',
  ) {
    super(message)
    this.name = 'CapabilityRequiredError'
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

const actions = new Map<string, Action<unknown, unknown, unknown>>()

/** Registers an action under its name; last registration wins (useful in tests). */
export const registerAction = <I, O, R>(action: Action<I, O, R>): void => {
  actions.set(action.name, action as Action<unknown, unknown, unknown>)
}

/**
 * Every registered action, for the access-registry audit (TECH-14). Reading
 * this needs the registry populated — import actions/register-all first.
 */
export const listActions = (): Action<unknown, unknown, unknown>[] => [
  ...actions.values(),
]

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

  // Authorization first, metering second (TECH-14). A caller with no rights
  // to the resource must be refused, not told their plan is exhausted — and
  // whatever the policy loaded to decide is handed to execute, so the action
  // does not fetch it a second time.
  const access = await action.access?.authorize(ctx, parsed.data)
  await action.meter?.(ctx, parsed.data)

  // Everything the action does — including provider calls several layers down —
  // is attributed to the acting user, so adapters can meter what they spend
  // without taking a userId through the vendor-neutral interfaces (BILL-3).
  //
  // Payer and actor are the same person here, and saying so explicitly is what
  // lets the cost ledger separate an instructor's own spend from their
  // audience's (BILL-7). The paths where they differ — a viewer's playback
  // charged to a deck's owner — set their own attribution.
  const run = () => action.execute(ctx, parsed.data, access) as Promise<O>
  if (!ctx.userId) return run()

  // Which lecture and project this belongs to, read off the input the action
  // already declared (BILL-7). Doing it here rather than per action is what
  // keeps sixty definitions from each needing an attribution hook that one of
  // them would eventually forget. One indexed lookup, and only when the input
  // names something; an action that names nothing attributes to the user
  // alone, exactly as before.
  const entity = await entityFromInput(parsed.data)
  return runWithUsage(
    { userId: ctx.userId, actorId: ctx.userId, ...entity },
    run,
  )
}

/**
 * Runs an action in-process from a typed reference rather than a name, with
 * the same pipeline — for callers inside the server that already hold the
 * action, where going through `dispatch` by string would only lose the types.
 *
 * `meter: false` opts a trusted local caller out of plan caps. The HTTP path
 * never may: it is offered for work the server does on its own behalf, such
 * as seeding a development database, which should not be refused because the
 * account it is writing for has spent its allowance.
 */
export const runAction = async <I, O, R>(
  action: Action<I, O, R>,
  ctx: ActionContext,
  input: I,
  options: { meter?: boolean } = {},
): Promise<O> => {
  const parsed = action.input.safeParse(input)
  if (!parsed.success) {
    throw new ActionValidationError(
      action.name,
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  const access = (await action.access?.authorize(ctx, parsed.data)) as R
  if (options.meter !== false) await action.meter?.(ctx, parsed.data)

  const run = () => action.execute(ctx, parsed.data, access)
  if (!ctx.userId) return run()
  const entity = await entityFromInput(parsed.data)
  return runWithUsage(
    { userId: ctx.userId, actorId: ctx.userId, ...entity },
    run,
  )
}
