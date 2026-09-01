/**
 * Unit tests for the scope vocabulary (docs/MCP.md §5.4).
 *
 * The behaviour that matters is the implication: a write grant covers reading,
 * because an assistant that may edit a slide must be able to look it up first.
 * Get that wrong in the permissive direction and a read-only grant silently
 * writes; get it wrong in the strict direction and every edit fails on a
 * lookup the user thought they had approved.
 */
import { describe, expect, it } from 'vitest'
import type { ZodRawShape } from 'zod'
import {
  ALL_SCOPES,
  SCOPES,
  SCOPE_DESCRIPTIONS,
  isScope,
  satisfies,
  scopeForTool,
} from './scopes'
import type { McpTool } from '../mcp/tool'
import './../mcp/tools/register-all'
import { listTools } from '../mcp/registry'

describe('isScope', () => {
  it('accepts the two this server defines', () => {
    expect(isScope(SCOPES.read)).toBe(true)
    expect(isScope(SCOPES.write)).toBe(true)
  })

  it('rejects anything else, rather than passing it through', () => {
    // An unrecognised scope must not survive into a grant, where it would
    // read as a permission nobody defined.
    expect(isScope('lectures.delete')).toBe(false)
    expect(isScope('')).toBe(false)
  })
})

describe('satisfies', () => {
  it('grants what was granted', () => {
    expect(satisfies([SCOPES.read], SCOPES.read)).toBe(true)
    expect(satisfies([SCOPES.write], SCOPES.write)).toBe(true)
  })

  it('lets a write grant read, since editing needs looking first', () => {
    expect(satisfies([SCOPES.write], SCOPES.read)).toBe(true)
  })

  it('never lets a read grant write', () => {
    expect(satisfies([SCOPES.read], SCOPES.write)).toBe(false)
  })

  it('refuses everything to a connection holding nothing', () => {
    expect(satisfies([], SCOPES.read)).toBe(false)
    expect(satisfies([], SCOPES.write)).toBe(false)
  })
})

describe('scopeForTool', () => {
  const tool = (readOnly: boolean): McpTool<ZodRawShape> =>
    ({ name: 't', readOnly }) as McpTool<ZodRawShape>

  it('asks only for reading when a tool only reads', () => {
    expect(scopeForTool(tool(true))).toBe(SCOPES.read)
  })

  it('asks for writing when a tool writes', () => {
    expect(scopeForTool(tool(false))).toBe(SCOPES.write)
  })

  it('classifies every registered tool without inventing a third scope', () => {
    for (const registered of listTools()) {
      expect(ALL_SCOPES, registered.name).toContain(scopeForTool(registered))
    }
  })
})

describe('the consent screen’s wording', () => {
  it('describes every scope, in terms a person can answer', () => {
    // A scope with no sentence next to it makes the screen theatre — the
    // user is asked to approve a machine-readable string.
    for (const scope of ALL_SCOPES) {
      expect(SCOPE_DESCRIPTIONS[scope]?.length).toBeGreaterThan(20)
    }
  })

  it('stays small enough that the screen can be read', () => {
    // Twenty fine-grained scopes make a dialog nobody parses; this is the
    // design constraint from docs/MCP.md §5.4, pinned so it is a decision to
    // change rather than a drift.
    expect(ALL_SCOPES.length).toBeLessThanOrEqual(4)
  })
})
