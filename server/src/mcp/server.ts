/**
 * Builds the MCP server that an external assistant talks to (docs/MCP.md).
 *
 * Everything protocol-shaped — the JSON-RPC framing, capability negotiation,
 * the Streamable HTTP transport — comes from the official SDK. That is a
 * deliberate choice rather than a shortcut: the MCP authorization and transport
 * specs are young and still moving (docs/MCP.md §5.4), and a hand-rolled
 * transport is code this project would have to track the spec with forever.
 * What is written here is only the part that is ours: which tools exist, and
 * what happens when one is called.
 *
 * A fresh server and transport are built per request, in stateless mode. An
 * MCP session is a conversation between one assistant and one account, and
 * nothing about answering a tool call needs to outlive the call — so there is
 * no session map to leak memory, no cross-request state to confuse two
 * assistants, and no affinity requirement when the app runs on more than one
 * instance (TECH-10).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ActionContext } from '../actions/context'
import { callerFor } from './tool'
import { findTool, listTools } from './registry'
import { describeErrorForAgent } from '../actions/agent-error'
import { APP_VERSION } from '../lib/app-version'
// Registers every tool (docs/MCP.md §4). One list, shared with the test that
// checks none of them reaches a forbidden action.
import './tools/register-all'

/**
 * Runs one tool and shapes the answer for a model.
 *
 * Failures come back as `isError` tool results rather than JSON-RPC errors,
 * which is the MCP convention and the more useful one here: a protocol error
 * ends the call, while an error *result* is handed to the model, which can
 * read the prose and correct the call itself. `describeErrorForAgent` is what
 * makes that prose worth reading — it says whether retrying could ever work.
 */
export const runTool = async (
  name: string,
  args: unknown,
  ctx: ActionContext,
): Promise<CallToolResult> => {
  const tool = findTool(name)
  // The SDK refuses an unregistered tool before this runs, so this is
  // unreachable through the transport. It is kept because `runTool` is
  // exported and a future in-process caller would otherwise dereference null.
  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: `No tool named "${name}".` }],
    }
  }

  try {
    const output = await tool.run(callerFor(tool, ctx), args as never)
    return {
      content: [{ type: 'text', text: output.text }],
      ...(output.data === undefined
        ? {}
        : { structuredContent: output.data as Record<string, unknown> }),
    }
  } catch (err) {
    const described = describeErrorForAgent(err)
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `${described.message} (code: ${described.code}, retryable: ${described.retryable})`,
        },
      ],
    }
  }
}

/**
 * An MCP server carrying every registered tool, bound to one caller's context.
 *
 * The context is captured here rather than read per call, which is what keeps
 * the tools themselves free of any notion of who is acting: a tool receives a
 * fenced `call` function and its own arguments, and has no way to act as
 * anyone else.
 */
export const createMcpServer = (ctx: ActionContext): McpServer => {
  const server = new McpServer(
    { name: 'slide-machine', version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Slide Machine holds an instructor’s lectures: a lecture is a deck of ' +
        'slides inside a project, drawn with a template. Start with ' +
        'find_lectures to get a lecture id, then read_lecture to get slide ids ' +
        '— nothing else will give you either. Prefer one batched edit_slides ' +
        'call over several single edits. Deleting, sharing, publishing and ' +
        'anything that spends money are deliberately not available here; if ' +
        'the user asks for one of those, tell them to do it in the app.',
    },
  )

  for (const tool of listTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          // Nothing on this surface deletes or overwrites irrecoverably —
          // that is what mcp/forbidden.ts is for — so no tool is destructive,
          // and a client may say so when it asks the user to approve one.
          destructiveHint: false,
          // Every write here replaces a value rather than accumulating, so
          // repeating a call lands in the same place it did the first time.
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (args: unknown) => runTool(tool.name, args, ctx),
    )
  }

  return server
}
