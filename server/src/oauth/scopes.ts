/**
 * What an assistant can be granted (docs/MCP.md §5.4).
 *
 * There are two, and the number is the design. One "do everything" scope makes
 * the consent screen theatre — nobody is deciding anything. Twenty fine-grained
 * ones make a dialog nobody reads, which is theatre with extra steps. The
 * useful question a person can actually answer in the two seconds they will
 * spend on that screen is "can it change my lectures, or only look at them?",
 * so that is the question the scopes ask.
 *
 * Scopes narrow; they never widen. A token scoped `lectures.write` still can
 * only reach the ten tools on the surface, still passes every ownership check,
 * and still cannot delete or share anything — because those are not tools at
 * all (mcp/forbidden.ts). Scope is the second fence, not the first.
 */
import type { McpTool } from '../mcp/tool'
import type { ZodRawShape } from 'zod'

export const SCOPES = {
  /** See lectures, slides and designs. */
  read: 'lectures.read',
  /** Create and change lectures and slides. */
  write: 'lectures.write',
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]

export const ALL_SCOPES: readonly Scope[] = [SCOPES.read, SCOPES.write]

/** What the consent screen says each one means, in the user's own terms. */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  [SCOPES.read]: 'See your lectures, their slides, and your designs',
  [SCOPES.write]:
    'Create and change lectures and slides, and switch their design',
}

/** Whether a string is one of ours; anything else is refused rather than ignored. */
export const isScope = (value: string): value is Scope =>
  (ALL_SCOPES as readonly string[]).includes(value)

/**
 * The scope a tool needs.
 *
 * Read-only tools need `lectures.read`; everything else needs
 * `lectures.write`. Derived from the tool's own `readOnly` flag rather than
 * declared a second time, so the two can never disagree — and `readOnly` is
 * already checked against the actions a tool composes
 * (mcp/forbidden.test.ts), which is what makes deriving from it safe.
 */
export const scopeForTool = (tool: McpTool<ZodRawShape>): Scope =>
  tool.readOnly ? SCOPES.read : SCOPES.write

/**
 * A write grant implies the read one.
 *
 * An assistant that may edit a lecture must be able to read it first — it
 * cannot edit a slide whose id it was never allowed to look up. Making the
 * implication explicit here keeps it out of every call site, and keeps the
 * consent screen from having to ask a question with only one sensible answer.
 */
export const satisfies = (granted: readonly string[], needed: Scope): boolean =>
  granted.includes(needed) ||
  (needed === SCOPES.read && granted.includes(SCOPES.write))
