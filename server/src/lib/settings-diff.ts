/**
 * Entity-agnostic settings diff, shared by both audit trails: the admin
 * action log (ADMIN-5) and the settings change log. Callers snapshot an
 * entity's settings before and after applying an edit (lib/settings-
 * snapshot.ts) and pass both here; the result is what an entry records as
 * its changed fields, and an empty result means the edit changed nothing
 * (no save, no log entry).
 */
import type {
  SettingsChanges,
  SettingsFieldChange,
} from '@slide-machine/shared'

/** One field's old and new value, as recorded in a log entry. */
export type FieldChange = SettingsFieldChange

export type { SettingsChanges }

/** Longest string kept in a recorded value; a long bio must not inflate
 * the append-only log. Truncated values end with an ellipsis. */
const MAX_VALUE_CHARS = 200

/**
 * Normalizes one value for the log: `undefined` becomes `null` (JSON
 * drops undefined, which would make the field vanish from the CSV export
 * and the Logs page), and long strings are truncated.
 */
const recordable = (value: unknown): unknown => {
  if (value === undefined) return null
  if (typeof value === 'string' && value.length > MAX_VALUE_CHARS) {
    return `${value.slice(0, MAX_VALUE_CHARS)}…`
  }
  return value
}

/**
 * Shallow diff over the union of both snapshots' keys. Values are
 * compared with `!==` before normalization, so `false`, `0`, and `''` are
 * each distinct from `undefined` — only settings that really changed are
 * recorded.
 */
export const diffSettings = <T extends object>(
  before: T,
  after: T,
): SettingsChanges => {
  const from = before as Record<string, unknown>
  const to = after as Record<string, unknown>
  const changes: SettingsChanges = {}
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (from[key] === to[key]) continue
    changes[key] = { from: recordable(from[key]), to: recordable(to[key]) }
  }
  return changes
}
