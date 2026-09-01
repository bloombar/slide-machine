/**
 * Unit tests for the machine-readable action catalog (TECH-13).
 *
 * What matters here is not that a schema converts — Zod's converter is not
 * ours to test — but that the catalog tells the truth about the registry it
 * describes: every registered action present, its declared access rule carried
 * through unchanged, and an input contract a model could actually fill in.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { z } from 'zod'
import '../actions/register-all'
import { defineAction } from './define'
import { listActions, registerAction } from './dispatch'
import { open as openAccess } from './access'
import {
  actionCatalog,
  catalogEntry,
  clearCatalogCache,
  describedCatalog,
  inputJsonSchema,
} from './catalog'

describe('actionCatalog', () => {
  beforeEach(() => {
    clearCatalogCache()
  })

  it('describes every registered action', () => {
    expect(actionCatalog()).toHaveLength(listActions().length)
  })

  it('lists entries in name order, so a diff of the catalog is readable', () => {
    const names = actionCatalog().map(entry => entry.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('carries each action’s declared access descriptor through unchanged', () => {
    const entry = catalogEntry('slide.editContent')
    expect(entry?.access).toEqual({ resource: 'slide', level: 'edit' })
  })

  it('derives an object input schema for every action', () => {
    // A model is handed these as tool arguments, which are always an object.
    for (const entry of actionCatalog()) {
      expect(entry.inputSchema.type, entry.name).toBe('object')
    }
  })

  it('derives the required and optional halves of a real action’s input', () => {
    const entry = catalogEntry('slide.editContent')
    expect(entry?.inputSchema.required).toEqual(['slideId'])
    expect(
      Object.keys(entry?.inputSchema.properties as Record<string, unknown>),
    ).toContain('bullets')
  })

  it('reports no description for an action nobody has exposed', () => {
    expect(catalogEntry('template.previewImage')?.description).toBeNull()
  })

  it('returns undefined for an action that is not registered', () => {
    expect(catalogEntry('nope.missing')).toBeUndefined()
  })

  it('builds once and serves the same array again', () => {
    expect(actionCatalog()).toBe(actionCatalog())
  })

  it('picks up an action registered after the cache is cleared', () => {
    registerAction(
      defineAction({
        name: 'zz.catalogProbe',
        description: 'A probe action, registered by the catalog test.',
        access: openAccess(),
        input: z.object({ nickname: z.string().min(1) }),
        execute: async () => 'ok',
      }),
    )
    clearCatalogCache()

    const entry = catalogEntry('zz.catalogProbe')
    expect(entry?.description).toBe(
      'A probe action, registered by the catalog test.',
    )
    expect(entry?.inputSchema.required).toEqual(['nickname'])
  })
})

describe('describedCatalog', () => {
  beforeEach(() => {
    clearCatalogCache()
  })

  it('offers only the actions whose author wrote a description', () => {
    registerAction(
      defineAction({
        name: 'zz.describedProbe',
        description: 'Described, and therefore offerable.',
        access: openAccess(),
        input: z.object({}),
        execute: async () => 'ok',
      }),
    )
    clearCatalogCache()

    const described = describedCatalog()
    expect(described.every(entry => entry.description.length > 0)).toBe(true)
    expect(described.map(entry => entry.name)).toContain('zz.describedProbe')
    expect(described.map(entry => entry.name)).not.toContain(
      'template.previewImage',
    )
  })
})

describe('inputJsonSchema', () => {
  it('drops the dialect declaration, which MCP clients do not expect', () => {
    const schema = inputJsonSchema(z.object({ id: z.string() }))
    expect(schema.$schema).toBeUndefined()
  })

  it('describes what a caller must send, not what a default produces', () => {
    // io: 'input' — a defaulted field is optional to the caller even though
    // the parsed value always has it. The output view would wrongly tell a
    // model the field is required.
    const schema = inputJsonSchema(
      z.object({ limit: z.number().default(10), id: z.string() }),
    )
    expect(schema.required).toEqual(['id'])
  })

  it('emits a permissive schema rather than throwing on an unrepresentable type', () => {
    // The real contract is still enforced by dispatch, which parses with the
    // actual Zod schema; the catalog only describes.
    const schema = inputJsonSchema(
      z.object({ when: z.custom<Date>(value => value instanceof Date) }),
    )
    expect(schema.type).toBe('object')
  })
})
