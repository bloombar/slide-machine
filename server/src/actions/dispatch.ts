/**
 * Action dispatcher (SPEC TECH-13). Runs the validate → authorize → meter →
 * execute pipeline for a named action. Errors are typed so the HTTP layer
 * can map them to status codes (400 / 403 / 402) uniformly.
 */
import type { Action } from './define'
import type { ActionContext } from './context'

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
  return (await action.execute(ctx, parsed.data)) as O
}
