/**
 * The "Details" section of an admin detail page (ADMIN-5): the entity's
 * facts as a plain list, with the settings among them editable in place.
 *
 * It opens read-only and unlocks only after the admin clicks **Edit** and
 * acknowledges that the edit is audited — the same confirmation they get
 * before editing another user's project or lecture. Once unlocked it
 * holds a draft, so the controls change nothing until **Save changes**,
 * which opens a confirm dialog listing every `old → new` before a single
 * request lands. Nothing is saved while the draft matches what is stored,
 * and the server records the exact before/after of every field in the
 * audit log.
 *
 * Children are render-propped the mode, the draft, and a setter, so each
 * page lays out its own rows — DetailRow for the facts that are only
 * read, DetailField for those that turn into controls.
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

/** What the children are given: whether the list is unlocked, the draft
 * being edited, and how to change one of its fields. */
export interface DetailsPanelState<T> {
  editing: boolean
  draft: T
  set: <K extends keyof T>(field: K, value: T[K]) => void
}

interface Props<T extends object> {
  /** The saved settings. The draft follows these, so a refetch after a
   * save (or after switching entities) resets the form. */
  value: T
  /** The editable fields and how each is named in the confirm list. */
  labels: FieldLabels<T>
  /** Heading of the save dialog, e.g. "Save these profile settings?". */
  confirmTitle: string
  /** Heading of the dialog shown before the list unlocks. */
  editConfirmTitle: string
  /** That dialog's body: whose settings these are, and that every change
   * is recorded in the audit log. */
  editConfirmMessage: string
  /** Sends the patch; resolves once the page has the new values. */
  onSave: (patch: SettingsPatch<T>) => Promise<void>
  children: (state: DetailsPanelState<T>) => ReactNode
}

export default function DetailsPanel<T extends object>({
  value,
  labels,
  confirmTitle,
  editConfirmTitle,
  editConfirmMessage,
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
  // The list stays read-only until the admin asks to edit and confirms
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changes = describeChanges(value, draft, labels)

  const set = <K extends keyof T>(field: K, next: T[K]) => {
    setDraft(current => ({ ...current, [field]: next }))
    setNotice(null)
  }

  /** Locks the list again, dropping whatever was not saved. */
  const stopEditing = () => {
    setEditing(false)
    setDraft(value)
    setError(null)
  }

  /** Sends exactly the changed fields, then lets the page refetch. The
   * list locks again on success, showing what was just saved. */
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
      setEditing(false)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save settings.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-700">Details</h2>
        {!editing && (
          <button
            onClick={() => setAsking(true)}
            className="text-sm text-slate-500 hover:underline"
          >
            Edit
          </button>
        )}
      </div>

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

      <dl>{children({ editing, draft, set })}</dl>

      {editing && (
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setConfirming(true)}
            disabled={changes.length === 0 || saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={stopEditing}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      )}

      {asking && (
        <ConfirmDialog
          title={editConfirmTitle}
          message={editConfirmMessage}
          confirmLabel="Edit settings"
          onConfirm={() => {
            setAsking(false)
            setNotice(null)
            setEditing(true)
          }}
          onCancel={() => setAsking(false)}
        />
      )}

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
