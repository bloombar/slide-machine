/**
 * Turns an admin settings draft into the human list of edits shown in the
 * confirm dialog before a save (ADMIN-5). The same list decides whether
 * the form is dirty — no changes, nothing to save.
 *
 * This is a summary for the person clicking Save. The audit entry the
 * server writes is the authoritative record of what actually changed.
 */

/** One edit, ready to render as "label: from → to". */
export interface DescribedChange {
  field: string
  label: string
  from: string
  to: string
}

/** How one editable field is described. A bare string is just its name. */
export interface FieldLabel {
  label: string
  /** Renders one value; defaults to formatValue. */
  format?: (value: unknown) => string
}

/** The editable fields of a draft, and how to describe each. Fields left
 * out are not offered for editing and never appear in the list. */
export type FieldLabels<T> = { [K in keyof T & string]?: string | FieldLabel }

/**
 * Default rendering of a settings value: an unset field reads as
 * inherited (that is what unset means at every level), booleans as
 * Yes/No, everything else as itself.
 */
export const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return 'Default (inherited)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** The fields where `draft` differs from `current`, in label order. */
export const describeChanges = <T extends object>(
  current: T,
  draft: T,
  labels: FieldLabels<T>,
): DescribedChange[] =>
  (Object.keys(labels) as (keyof T & string)[]).flatMap(field => {
    if (current[field] === draft[field]) return []
    const spec = labels[field]!
    const { label, format = formatValue } =
      typeof spec === 'string' ? { label: spec, format: undefined } : spec
    return [
      { field, label, from: format(current[field]), to: format(draft[field]) },
    ]
  })
