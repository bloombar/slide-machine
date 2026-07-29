/**
 * One line of an admin "Details" list that the admin may edit: the stored
 * value while the list is read-only, the given control once it unlocks.
 * Pass `htmlFor` when the control is a single input, so its id labels it;
 * controls that label themselves (a LanguageSelect, say) leave it out.
 */
import type { ReactNode } from 'react'
import DetailRow from './DetailRow'

export default function DetailField({
  label,
  value,
  editing,
  htmlFor,
  hint,
  children,
}: {
  label: string
  /** How the value reads while the list is locked. */
  value: string
  editing: boolean
  htmlFor?: string
  /** One line under the control explaining what the field affects. */
  hint?: string
  children: ReactNode
}) {
  if (!editing) return <DetailRow label={label} value={value} />

  return (
    <div className="flex gap-2 py-1.5 text-sm">
      <dt className="w-36 shrink-0 pt-2 text-slate-500">
        {htmlFor ? (
          <label htmlFor={htmlFor}>{label}</label>
        ) : (
          <span>{label}</span>
        )}
      </dt>
      <dd className="min-w-0 max-w-md flex-1">
        {children}
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </dd>
    </div>
  )
}
