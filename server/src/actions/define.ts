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
  /**
   * What the action does, in a sentence or two written for an AI model rather
   * than a developer — the human-readable half of the machine-readable catalog
   * (TECH-13, actions/catalog.ts).
   *
   * Optional, and deliberately so. Most of the ninety-odd registered actions
   * will never be offered to a model, and writing a sentence for each of those
   * would be effort spent on entries nobody reads. Write the description when
   * something actually exposes the action; until then its absence is the
   * honest answer, and `describedCatalog` leaves it out.
   */
  description?: string
  /** Input schema; dispatch rejects anything that does not parse. */
  input: ZodType<I>
  /**
   * How this action is authorized, declared rather than checked in its body
   * (TECH-14). The dispatcher runs it before `meter`, so a caller with no
   * rights to the resource is refused before they can be told anything about
   * their plan — and hands whatever it loaded to `execute`, so no action pays
   * twice for the same lookup.
   *
   * Required. An action with no declaration does not compile, which is the
   * whole point: before this, a missing authorization check failed nothing —
   * not a test, not a type, not a lint — so it was indistinguishable from a
   * deliberate one. Operations whose rule is genuinely not one resource at one
   * level declare `custom(reason)`; silence is not an option.
   */
  access: AccessPolicy<I, R>
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
