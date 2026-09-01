/**
 * The machine-readable action catalog (SPEC TECH-13).
 *
 * The action registry already knows every operation the application offers and
 * the Zod schema each one validates its input with. What it has never been
 * able to do is *say* so to something that is not TypeScript. This module is
 * that translation: for every registered action, its name, its human-readable
 * description, its input contract as JSON Schema, and the access rule it
 * declared (TECH-14).
 *
 * It is machinery, not a tool list. Deciding *which* actions an AI assistant
 * is offered, and at what granularity, is a separate design question answered
 * per consumer (docs/MCP.md §3.6) — the in-app assistant scopes its list to
 * the current screen, the MCP server hands out a small set of hand-designed
 * intent tools. Both read their contracts from here rather than maintaining a
 * parallel hand-written list that drifts from the code.
 *
 * Descriptions are deliberately optional. There are ninety-odd actions and
 * most will never be shown to a model; backfilling a sentence for each would
 * be work spent on entries nobody reads. An action gets a description when
 * something exposes it — and `describedCatalog` is what a consumer calls when
 * it needs only the ones that have one.
 */
import { z } from 'zod'
import type { ZodType } from 'zod'
import { listActions } from './dispatch'
import type { AccessDescriptor } from './access/policy'

/** A JSON Schema document, kept loose because that is what the standard is. */
export type JsonSchema = Record<string, unknown>

/** One action, as something other than TypeScript can read it. */
export interface CatalogEntry {
  /** The dotted action name, e.g. `slide.editContent`. */
  name: string
  /**
   * One or two sentences saying what the action does, written for a model
   * rather than a developer. Null when the action has never been exposed.
   */
  description: string | null
  /** The input contract, derived from the action's Zod schema. */
  inputSchema: JsonSchema
  /** How the action is authorized — the same descriptor the audit index reads. */
  access: AccessDescriptor
}

/**
 * Derivation options, pinned here rather than at each call site so every
 * consumer sees the same dialect.
 *
 * - `io: 'input'` — what a caller must send, which is not always what the
 *   action produces: a schema with a default or a transform has two faces and
 *   the output one would tell a model to send fields it must not send.
 * - `unrepresentable: 'any'` — a few Zod constructs have no JSON Schema
 *   equivalent. Emitting a permissive schema for those is right: the real
 *   contract is still enforced by `dispatch`, which parses with the actual Zod
 *   schema. The catalog describes; it never validates.
 * - `cycles: 'ref'` — a self-referential schema becomes a `$ref` instead of
 *   throwing.
 */
const DERIVATION = {
  io: 'input',
  unrepresentable: 'any',
  cycles: 'ref',
  reused: 'inline',
} as const

/**
 * Turns one action's Zod schema into JSON Schema.
 *
 * The `$schema` key is dropped. The dialect is fixed by `DERIVATION` and every
 * consumer of this catalog knows it, so carrying the declaration adds nothing
 * — and MCP clients in particular expect a bare tool input schema.
 */
export const inputJsonSchema = (schema: ZodType): JsonSchema => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(
    schema,
    DERIVATION,
  ) as JsonSchema
  return rest
}

/**
 * Deriving ninety schemas is not free and none of them change while the
 * process runs, so the catalog is built once. `clearCatalogCache` exists for
 * tests that register an action after the first read.
 */
let cache: CatalogEntry[] | null = null

/** Forgets the built catalog, so a newly registered action is picked up. */
export const clearCatalogCache = (): void => {
  cache = null
}

/**
 * Every registered action, in name order.
 *
 * Reading this needs the registry populated — import `actions/register-all`
 * first, exactly as the access audit does.
 */
export const actionCatalog = (): CatalogEntry[] => {
  if (cache) return cache
  cache = listActions()
    .map(action => ({
      name: action.name,
      description: action.description ?? null,
      inputSchema: inputJsonSchema(action.input),
      access: action.access.descriptor,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return cache
}

/** One action's catalog entry, or undefined when no such action is registered. */
export const catalogEntry = (name: string): CatalogEntry | undefined =>
  actionCatalog().find(entry => entry.name === name)

/**
 * The subset an AI channel can honestly show a model: the actions whose author
 * wrote a description. An undescribed action is not hidden for safety — that
 * is what the exposure decision in each consumer is for — it is hidden because
 * a tool with no description is a tool a model will misuse.
 */
export const describedCatalog = (): (CatalogEntry & {
  description: string
})[] =>
  actionCatalog().filter(
    (entry): entry is CatalogEntry & { description: string } =>
      entry.description !== null,
  )
