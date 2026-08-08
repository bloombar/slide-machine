/**
 * Action definitions (SPEC TECH-13). Every operation that modifies a
 * project, concept set, or deck is a named action with a validated input
 * schema and declared authorization, so the React UI, verbal preflight,
 * reformat, and future agents all share one secure path.
 */
import type { ZodType } from 'zod'
import type { ActionContext } from './context'
import type { AccessPolicy } from './access/policy'

export interface Action<I = unknown, O = unknown, R = unknown> {
  /** Dotted action name, e.g. "slide.editContent" or "deck.switchTemplate". */
  name: string
  /** Input schema; dispatch rejects anything that does not parse. */
  input: ZodType<I>
  /**
   * How this action is authorized, declared rather than checked in its body
   * (TECH-14). The dispatcher runs it before `meter`, so a caller with no
   * rights to the resource is refused before they can be told anything about
   * their plan — and hands whatever it loaded to `execute`, so no action pays
   * twice for the same lookup.
   *
   * Optional only until the last action declares one, at which point this
   * becomes required and a missing declaration is a compile error.
   */
  access?: AccessPolicy<I, R>
  /** Plan-cap metering hook (BILL-3). Default is a no-op. */
  meter?: (ctx: ActionContext, input: I) => Promise<void>
  /**
   * Does the work. `access` is whatever the declared policy resolved — the
   * documents it had to load to authorize the call. Actions that have not
   * been migrated simply take two parameters and ignore it, which is why the
   * migration can proceed one family at a time.
   */
  execute: (ctx: ActionContext, input: I, access: R) => Promise<O>
}

/** Identity helper that pins the generic types of an action definition. */
export const defineAction = <I, O, R = undefined>(
  action: Action<I, O, R>,
): Action<I, O, R> => action
