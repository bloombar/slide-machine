/**
 * The "Settings" section of an admin detail page (ADMIN-5). It holds a
 * draft of the entity's settings, so the controls inside it change
 * nothing until **Save changes** — which opens a confirm dialog listing
 * every `old → new` before a single request lands. Nothing is saved while
 * the draft matches what is stored, and the server records the exact
 * before/after of every field in the audit log.
 *
 * Children are render-propped the draft and a setter, so each page
 * supplies its own controls for its own fields.
 */
import { useState, type ReactNode } from 'react'
import ConfirmDialog from '../ConfirmDialog'
import { ApiError } from '../../api/http'
import { describeChanges, type FieldLabels } from '../../lib/admin-changes'

/**
 * The wire patch for a draft of shape T: only the changed fields, with
 * `undefined` sent as an explicit `null` — `JSON.stringify` drops
 * undefined, and null is what clears a level back to inherited.
 */
export type SettingsPatch<T> = { [K in keyof T]?: T[K] | null }

interface Props<T extends object> {
  /** The saved settings. The draft follows these, so a refetch after a
   * save (or after switching entities) resets the form. */
  value: T
  /** The editable fields and how each is named in the confirm list. */
  labels: FieldLabels<T>
  /** Heading of the confirm dialog, e.g. "Save these lecture settings?". */
  confirmTitle: string
  /** One line under the section heading. */
  description: string
  /** Sends the patch; resolves once the page has the new values. */
  onSave: (patch: SettingsPatch<T>) => Promise<void>
  children: (
    draft: T,
    set: <K extends keyof T>(field: K, value: T[K]) => void,
  ) => ReactNode
}

export default function SettingsPanel<T extends object>({
  value,
  labels,
  confirmTitle,
  description,
  onSave,
  children,
}: Props<T>) {
  const [draft, setDraft] = useState<T>(value)
  // Derived-state-from-props (the sanctioned render-time pattern): follow
  // the saved settings when they change. Compared by value, since the
  // pages build `value` fresh on every render.
  const saved = JSON.stringify(value)
  const [lastSaved, setLastSaved] = useState(saved)
  if (saved !== lastSaved) {
    setLastSaved(saved)
    setDraft(value)
  }
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changes = describeChanges(value, draft, labels)

  const set = <K extends keyof T>(field: K, next: T[K]) => {
    setDraft(current => ({ ...current, [field]: next }))
    setNotice(null)
  }

  /** Sends exactly the changed fields, then lets the page refetch. */
  const save = async () => {
    setConfirming(false)
    setSaving(true)
    setNotice(null)
    setError(null)
    const patch: SettingsPatch<T> = {}
    for (const change of changes) {
      const field = change.field as keyof T
      const next = draft[field]
      patch[field] = next === undefined ? null : next
    }
    try {
      await onSave(patch)
      setNotice('Settings saved.')
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save settings.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 p-4">
      <h2 className="mb-1 text-lg font-semibold text-slate-700">Settings</h2>
      <p className="mb-4 text-sm text-slate-500">{description}</p>

      {notice && (
        <p role="status" className="mb-4 text-sm text-green-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-5">{children(draft, set)}</div>

      <div className="mt-6">
        <button
          onClick={() => setConfirming(true)}
          disabled={changes.length === 0 || saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          title={confirmTitle}
          confirmLabel="Save changes"
          onConfirm={() => void save()}
          onCancel={() => setConfirming(false)}
          message={
            <>
              <p>This edit is recorded in the audit log:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {changes.map(change => (
                  <li key={change.field}>
                    {`${change.label}: ${change.from} → ${change.to}`}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}
    </section>
  )
}
