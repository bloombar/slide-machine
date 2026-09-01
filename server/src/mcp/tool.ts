/**
 * What an MCP tool is, in this codebase (docs/MCP.md §4).
 *
 * The tempting shape for an MCP server over an action layer is one tool per
 * action, generated. It is the wrong shape, for reasons that are worth
 * restating where the code is: every tool definition sits in the model's
 * context on every turn, so ninety of them is a tax paid per message; every
 * call is a full model round-trip, so a tool that does one small thing costs a
 * turn; and the agent has no screen, so it cannot get from "Tuesday's lecture"
 * to a slide id the way a person clicking can. Several actions also exist only
 * because a user interface exists — `template.previewImage` fills a picker
 * grid — and mirroring would export scaffolding as agent tools.
 *
 * So tools here are hand-written and intent-shaped: a small set, each doing
 * something an instructor would recognise as a request. What "thin facade"
 * means is preserved exactly: **a tool may not do work of its own.** It
 * composes actions and shapes their results for a reader. It never touches a
 * model, never writes to the database, and cannot reach an action it did not
 * declare.
 *
 * That last guarantee is mechanical rather than a matter of care. A tool is
 * handed a `call` function, not an `ActionContext`, and `call` refuses any
 * action outside the tool's own `uses` list. A tool therefore cannot quietly
 * grow a second capability: reaching a new action means adding it to a
 * declaration that a test reads (mcp/forbidden.ts).
 */
import type { ZodRawShape, ZodObject } from 'zod'
import type { ActionContext } from '../actions/context'
import { dispatch } from '../actions/dispatch'

/**
 * Dispatches one of the actions a tool declared. Anything else throws — see
 * the module docstring.
 */
export type ActionCaller = <O = unknown>(
  action: string,
  input: unknown,
) => Promise<O>

/** What a tool hands back: prose for the model, and optionally the data behind it. */
export interface ToolOutput {
  /**
   * What happened, written to be read rather than rendered. This is the part
   * the model actually reasons over, so it carries the ids a follow-up call
   * will need.
   */
  text: string
  /**
   * The same answer as data, returned as MCP `structuredContent` for clients
   * that can use it. Optional: a confirmation ("renamed") has no data behind
   * it worth repeating.
   */
  data?: unknown
}

/** A hand-designed agent tool over one or more actions. */
export interface McpTool<Shape extends ZodRawShape = ZodRawShape> {
  /** MCP tool name — snake_case by convention, and stable once published. */
  name: string
  /** Short label a client may show a user when asking them to approve a call. */
  title: string
  /** What the tool does and when to reach for it, written for a model. */
  description: string
  /** The tool's arguments. A Zod shape; the SDK derives the JSON Schema. */
  input: Shape
  /**
   * True when the tool cannot change anything. Advertised to clients as MCP's
   * `readOnlyHint`, which is what lets an assistant run a search without
   * asking permission and stop before an edit.
   */
  readOnly: boolean
  /**
   * Every action this tool may dispatch. This is the exposure declaration
   * (docs/MCP.md §3.5): what an agent can reach through this server is the
   * union of these lists and nothing else, which is a set a reviewer can read
   * in one sitting.
   */
  uses: readonly string[]
  /** Does the work, by calling declared actions. */
  run: (
    call: ActionCaller,
    input: ZodObject<Shape>['_output'],
  ) => Promise<ToolOutput>
}

/** Identity helper that pins a tool's argument types. */
export const defineTool = <Shape extends ZodRawShape>(
  tool: McpTool<Shape>,
): McpTool<Shape> => tool

/**
 * A tool tried to dispatch an action it never declared. A programming error,
 * not a caller error — which is why it is a plain throw rather than one of the
 * typed dispatch errors an agent is shown.
 */
export class UndeclaredActionError extends Error {
  constructor(tool: string, action: string) {
    super(
      `Tool "${tool}" tried to call action "${action}", which is not in its declared uses`,
    )
    this.name = 'UndeclaredActionError'
  }
}

/**
 * Builds the `call` a tool is handed: the ordinary action dispatcher, fenced
 * to the actions this tool declared.
 *
 * Nothing about authorization, ownership, or plan-cap metering is re-decided
 * here — the fence is narrower than dispatch, never wider. A caller that may
 * not touch a lecture is refused by the action's own policy exactly as it
 * would be through the HTTP route.
 */
export const callerFor = (
  tool: McpTool<ZodRawShape>,
  ctx: ActionContext,
): ActionCaller => {
  const allowed = new Set(tool.uses)
  // `async` rather than a plain function, so the fence refusal arrives as a
  // rejected promise like every other failure a tool can meet. A synchronous
  // throw here would be caught by an `await` but not by a `.catch()`, which
  // is the kind of difference that only shows up in the one path nobody
  // wrote a test for.
  return async <O>(action: string, input: unknown): Promise<O> => {
    if (!allowed.has(action)) throw new UndeclaredActionError(tool.name, action)
    return dispatch<O>(action, input, ctx)
  }
}
