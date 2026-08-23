/**
 * The agent surface's safety boundary (docs/MCP.md §6).
 *
 * These are not tests of a function so much as tests of a claim: that what an
 * external assistant can reach through this server is a small, listed set, and
 * that nothing irreversible, outward-facing, or costly is in it. The claim is
 * only worth making if adding a tool that breaks it fails here — which is what
 * the registry sweeps below are for.
 */
import { describe, expect, it } from 'vitest'
import '../actions/register-all'
import { listActions } from '../actions/dispatch'
import { FORBIDDEN_ACTIONS, isForbiddenForAgents } from './forbidden'
import './tools/register-all'
import { listTools } from './registry'

describe('isForbiddenForAgents', () => {
  it('matches a named action exactly', () => {
    expect(isForbiddenForAgents('deck.delete')).toBe(true)
    expect(isForbiddenForAgents('deck.rename')).toBe(false)
  })

  it('matches a whole family by its prefix', () => {
    expect(isForbiddenForAgents('billing.checkout')).toBe(true)
    expect(isForbiddenForAgents('export.toDrive')).toBe(true)
  })

  it('does not match an action that merely starts with a forbidden name', () => {
    // 'deck.delete' is an exact entry, so a hypothetical 'deck.deleteDraft'
    // would have to be listed on its own rather than caught by accident.
    expect(isForbiddenForAgents('deck.deleteDraft')).toBe(false)
  })
})

describe('the forbidden list itself', () => {
  it('names actions that actually exist', () => {
    // A denylist entry for an action that was renamed protects nothing, and
    // reads in review as though it does.
    const registered = new Set(listActions().map(action => action.name))
    const stale = FORBIDDEN_ACTIONS.filter(
      entry => !entry.endsWith('.') && !registered.has(entry),
    )
    expect(stale).toEqual([])
  })

  it('has a registered action behind every family prefix', () => {
    const names = listActions().map(action => action.name)
    const emptyFamilies = FORBIDDEN_ACTIONS.filter(
      entry => entry.endsWith('.') && !names.some(n => n.startsWith(entry)),
    )
    expect(emptyFamilies).toEqual([])
  })
})

describe('the registered tool surface', () => {
  it('offers tools at all', () => {
    expect(listTools().length).toBeGreaterThan(0)
  })

  it('never composes a forbidden action', () => {
    const violations = listTools().flatMap(tool =>
      tool.uses
        .filter(isForbiddenForAgents)
        .map(action => `${tool.name} -> ${action}`),
    )
    expect(violations).toEqual([])
  })

  it('only declares actions that are actually registered', () => {
    // A typo in a `uses` entry would otherwise fail at call time, as a tool
    // that throws UndeclaredActionError on the one path nobody tested.
    const registered = new Set(listActions().map(action => action.name))
    const unknown = listTools().flatMap(tool =>
      tool.uses
        .filter(action => !registered.has(action))
        .map(action => `${tool.name} -> ${action}`),
    )
    expect(unknown).toEqual([])
  })

  it('declares every read-only tool over actions that only read', () => {
    // readOnlyHint is advertised to clients, and some will run a read-only
    // tool without asking the user. A tool that writes must not claim it.
    const writes =
      /\.(add|create|update|delete|set|edit|switch|reorder|rename|share|unshare|transfer|import|export|refine|reformat|vote|publish|generate|apply|duplicate|connect|checkout|change|portal)/i
    const liars = listTools()
      .filter(tool => tool.readOnly)
      .flatMap(tool =>
        tool.uses.filter(a => writes.test(a)).map(a => `${tool.name} -> ${a}`),
      )
    expect(liars).toEqual([])
  })

  it('gives every tool a name a model can tell apart from the others', () => {
    const names = listTools().map(tool => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('describes every tool, since a tool with no description is misused', () => {
    for (const tool of listTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40)
      expect(tool.title.length, tool.name).toBeGreaterThan(0)
    }
  })
})
