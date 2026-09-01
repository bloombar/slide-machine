/**
 * Unit tests for the MCP server builder (docs/MCP.md).
 *
 * Two things are ours here and worth testing: that every registered tool is
 * actually advertised with the hints a client uses to decide whether to ask
 * permission, and that a failing tool comes back as an error *result* the
 * model can read rather than a protocol error that ends the call.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { createMcpServer, runTool } from './server'
import { listTools, registerTool } from './registry'
import { defineTool } from './tool'
import { ALL_SCOPES, SCOPES } from '../oauth/scopes'
import * as dispatch from '../actions/dispatch'
import { ActionForbiddenError } from '../actions/dispatch'

const ctx = { userId: 'user-1', requestId: 'req-1' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createMcpServer', () => {
  it('advertises every registered tool', () => {
    const server = createMcpServer(ctx, ALL_SCOPES)
    // Reaching into the SDK's registry is the only way to see what a client
    // would be offered without standing up a transport and a client.
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    )
    expect(registered.sort()).toEqual(
      listTools()
        .map(t => t.name)
        .sort(),
    )
  })

  it('wires each advertised tool to the tool of the same name', async () => {
    vi.spyOn(dispatch, 'dispatch').mockResolvedValue([])
    const server = createMcpServer(ctx, ALL_SCOPES)
    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: unknown, extra: unknown) => Promise<unknown> }
        >
      }
    )._registeredTools

    // Called the way the SDK calls it, so the wiring between a registered
    // name and the tool that answers it is exercised rather than assumed.
    const result = await registered.find_lectures!.handler({}, {})
    expect(result).toMatchObject({ structuredContent: { lectures: [] } })
  })

  it('advertises only the tools this connection may actually use', () => {
    const server = createMcpServer(ctx, [SCOPES.read])
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    )

    expect(registered).toContain('find_lectures')
    expect(registered).not.toContain('edit_slides')
  })

  it('marks read-only tools as such, so a client can run them unprompted', () => {
    const server = createMcpServer(ctx, ALL_SCOPES)
    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { annotations?: Record<string, unknown> }
        >
      }
    )._registeredTools

    for (const tool of listTools()) {
      expect(registered[tool.name]?.annotations).toMatchObject({
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
      })
    }
  })
})

describe('runTool', () => {
  it('returns a tool’s prose as text, and its data as structured content', async () => {
    vi.spyOn(dispatch, 'dispatch').mockResolvedValue([])
    const result = await runTool('find_lectures', {}, ctx, ALL_SCOPES)

    expect(result.isError).toBeUndefined()
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.structuredContent).toEqual({ lectures: [] })
  })

  it('omits structured content for a tool that has no data behind its answer', async () => {
    // A confirmation has nothing to repeat as data, and sending an empty
    // object would tell a client there is structured output to read.
    registerTool(
      defineTool({
        name: 'zz_probe_confirmation',
        title: 'Probe',
        description: 'A tool that answers in prose alone, for this test.',
        readOnly: true,
        uses: [],
        input: { q: z.string().optional() },
        run: async () => ({ text: 'done' }),
      }),
    )

    const result = await runTool('zz_probe_confirmation', {}, ctx, ALL_SCOPES)
    expect(result.structuredContent).toBeUndefined()
    expect(result.content[0]).toEqual({ type: 'text', text: 'done' })
  })

  it('refuses a tool that is not registered', async () => {
    const result = await runTool('no_such_tool', {}, ctx, ALL_SCOPES)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      'no_such_tool',
    )
  })

  it('turns a refusal into a readable error result, not a protocol error', async () => {
    // An error *result* is handed to the model, which can act on it; a
    // protocol error ends the call and tells it nothing.
    vi.spyOn(dispatch, 'dispatch').mockRejectedValue(new ActionForbiddenError())
    const result = await runTool(
      'read_lecture',
      { lectureId: 'nope' },
      ctx,
      ALL_SCOPES,
    )

    expect(result.isError).toBe(true)
    const [first] = result.content as { type: string; text: string }[]
    expect(first?.text).toContain('code: forbidden')
    expect(first?.text).toContain('retryable: false')
  })

  it('refuses a write tool to a connection granted only reading', async () => {
    // The account behind the token could do this in the app. The point of
    // asking on the consent screen is that this connection may not.
    const result = await runTool(
      'rename_lecture',
      { lectureId: 'deck-1', title: 'x' },
      ctx,
      [SCOPES.read],
    )

    expect(result.isError).toBe(true)
    const [first] = result.content as { type: string; text: string }[]
    expect(first?.text).toContain('insufficient_scope')
    expect(first?.text).toContain(SCOPES.write)
  })

  it('lets a write grant read, since editing needs looking first', async () => {
    vi.spyOn(dispatch, 'dispatch').mockResolvedValue([])
    const result = await runTool('find_lectures', {}, ctx, [SCOPES.write])
    expect(result.isError).toBeUndefined()
  })

  it('names having no permissions at all, rather than listing an empty quote', async () => {
    const result = await runTool('find_lectures', {}, ctx, [])
    const [first] = result.content as { type: string; text: string }[]
    expect(first?.text).toContain('has none')
  })

  it('says nothing about an unexpected failure beyond that it failed', async () => {
    vi.spyOn(dispatch, 'dispatch').mockRejectedValue(
      new Error('mongodb://user:hunter2@10.0.0.4'),
    )
    const result = await runTool('list_templates', {}, ctx, ALL_SCOPES)

    expect(result.isError).toBe(true)
    const [first] = result.content as { type: string; text: string }[]
    expect(first?.text).not.toContain('hunter2')
    expect(first?.text).toContain('code: internal_error')
  })
})
