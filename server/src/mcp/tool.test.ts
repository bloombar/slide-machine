/**
 * Unit tests for the tool fence (docs/MCP.md §4).
 *
 * The property under test is the one that makes "thin facade" a guarantee
 * rather than a habit: a tool can reach exactly the actions it declared, and
 * reaching anything else is an error rather than a quiet extra capability.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { callerFor, defineTool, UndeclaredActionError } from './tool'
import * as dispatch from '../actions/dispatch'

const ctx = { userId: 'user-1', requestId: 'req-1' }

const probe = defineTool({
  name: 'probe',
  title: 'Probe',
  description: 'A tool that exists only to be called by this test.',
  readOnly: true,
  uses: ['deck.list'],
  input: { q: z.string().optional() },
  run: async call => ({ text: String(await call('deck.list', {})) }),
})

describe('callerFor', () => {
  beforeEach(() => {
    vi.spyOn(dispatch, 'dispatch').mockResolvedValue('dispatched')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches a declared action with the caller’s context', async () => {
    const call = callerFor(probe, ctx)
    await expect(call('deck.list', { projectId: 'p1' })).resolves.toBe(
      'dispatched',
    )
    expect(dispatch.dispatch).toHaveBeenCalledWith(
      'deck.list',
      { projectId: 'p1' },
      ctx,
    )
  })

  it('refuses an action the tool never declared, without dispatching it', async () => {
    const call = callerFor(probe, ctx)
    await expect(call('deck.delete', { deckId: 'd1' })).rejects.toThrow(
      UndeclaredActionError,
    )
    expect(dispatch.dispatch).not.toHaveBeenCalled()
  })

  it('names both the tool and the action it reached for', async () => {
    const call = callerFor(probe, ctx)
    await expect(call('deck.delete', {})).rejects.toThrow(
      /Tool "probe".*"deck.delete"/,
    )
  })
})

describe('defineTool', () => {
  it('hands the definition back unchanged, so types are pinned and nothing else', () => {
    expect(defineTool(probe)).toBe(probe)
  })
})
