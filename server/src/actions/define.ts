/**
 * Action definitions (SPEC TECH-13). Every operation that modifies a
 * project, concept set, or deck is a named action with a validated input
 * schema and authorize/meter hooks, so the React UI, verbal preflight,
 * reformat, and future agents all share one secure path.
 */
import type { ZodType } from 'zod'
import type { ActionContext } from './context'

export interface Action<I = unknown, O = unknown> {
  /** Dotted action name, e.g. "slide.editContent" or "deck.switchTemplate". */
  name: string
  /** Input schema; dispatch rejects anything that does not parse. */
  input: ZodType<I>
  /** Ownership/role check. Default allows all — tightened when auth lands. */
  authorize?: (ctx: ActionContext, input: I) => Promise<void>
  /** Plan-cap metering hook (BILL-3). Default is a no-op until billing lands. */
  meter?: (ctx: ActionContext, input: I) => Promise<void>
  execute: (ctx: ActionContext, input: I) => Promise<O>
}

/** Identity helper that pins the generic types of an action definition. */
export const defineAction = <I, O>(action: Action<I, O>): Action<I, O> => action
