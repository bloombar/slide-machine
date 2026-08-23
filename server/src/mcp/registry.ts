/**
 * The MCP tool registry.
 *
 * Deliberately the same shape as the action registry: tools register
 * themselves when their module loads, and one import list
 * (mcp/tools/register-all.ts) is what makes "every tool" mean anything. A tool
 * file that is not on that list is invisible — including to the test that
 * checks no tool reaches a forbidden action, which is exactly the property
 * that must not be quietly lost.
 */
import type { ZodRawShape } from 'zod'
import type { McpTool } from './tool'

const tools = new Map<string, McpTool<ZodRawShape>>()

/** Registers a tool under its name; last registration wins (useful in tests). */
export const registerTool = <Shape extends ZodRawShape>(
  tool: McpTool<Shape>,
): void => {
  tools.set(tool.name, tool as unknown as McpTool<ZodRawShape>)
}

/** Every registered tool, in name order. */
export const listTools = (): McpTool<ZodRawShape>[] =>
  [...tools.values()].sort((a, b) => a.name.localeCompare(b.name))

/** One tool by name, or undefined. */
export const findTool = (name: string): McpTool<ZodRawShape> | undefined =>
  tools.get(name)
