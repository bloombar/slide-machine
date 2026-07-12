/**
 * Access controls (SHARE-1), Google-Docs style, shared by lectures and
 * projects — the same component drives `deck.*` or `project.*` access
 * actions by entity. "People with access": add people by account email
 * with per-person role, revocation, and (owner-only) ownership
 * transfer. "General access": Public or Restricted.
 *
 * Lectures additionally surface inheritance: by default they follow
 * their project's settings (nothing stored on the lecture); the first
 * change here detaches them (copy-on-write, done server-side), and
 * "Use project settings" re-attaches.
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { DeckShare, ShareRole, Visibility } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import ConfirmDialog from './ConfirmDialog'

const GENERAL_ACCESS: Array<{
  value: Visibility
  label: string
  hint: string
}> = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone on the internet with the link can view',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    hint: 'Only people with access can open with the link',
  },
]

export interface AccessSubject {
  id: string
  /** Display name for confirmation copy. */
  name: string
  /** Effective general access. */
  visibility: Visibility
  /** Lectures only: true while following the project's settings. */
  accessInherited?: boolean
}

interface Props {
  /** Selects the action family (deck.setAccess … / project.setAccess …). */
  entity: 'deck' | 'project'
  subject: AccessSubject
  /** Only the owner may transfer ownership. */
  isOwner: boolean
  /** Fired with the updated deck/project after any saved change. */
  onChange: (updated: unknown) => void
}

export default function AccessSettings({
  entity,
  subject,
  isOwner,
  onChange,
}: Props) {
  const [shares, setShares] = useState<DeckShare[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [shareError, setShareError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingTransfer, setConfirmingTransfer] =
    useState<DeckShare | null>(null)

  const action = (name: string) => `${entity}.${name}`
  const idInput = { [`${entity}Id`]: subject.id }

  useEffect(() => {
    let cancelled = false
    dispatchAction<DeckShare[]>(action('shares'), idInput)
      .then(list => {
        if (!cancelled) setShares(list)
      })
      .catch(() => {
        // Quiet failure: the list simply stays empty
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, subject.id])

  const setGeneralAccess = (visibility: Visibility) => {
    dispatchAction(action('setAccess'), { ...idInput, visibility })
      .then(onChange)
      .catch(() => {
        // Quiet failure: the radios revert to the saved value on rerender
      })
  }

  const resetToProject = () => {
    dispatchAction(action('resetAccess'), idInput)
      .then(updated => {
        onChange(updated)
        // Back on project settings: re-read the effective people list
        return dispatchAction<DeckShare[]>(action('shares'), idInput).then(
          setShares,
        )
      })
      .catch(() => {
        // Quiet failure: the override simply stays
      })
  }

  const grant = (grantEmail: string, grantRole: ShareRole) =>
    dispatchAction<DeckShare[]>(action('share'), {
      ...idInput,
      email: grantEmail,
      role: grantRole,
    })

  const addPerson = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setShareError(null)
    try {
      setShares(await grant(email.trim(), role))
      setEmail('')
    } catch {
      setShareError('No account with that email')
    } finally {
      setBusy(false)
    }
  }

  const remove = (entry: DeckShare) => {
    dispatchAction<DeckShare[]>(action('unshare'), {
      ...idInput,
      userId: entry.userId,
      role: entry.role,
    })
      .then(setShares)
      .catch(() => {
        // Quiet failure: the entry simply stays listed
      })
  }

  const transferOwnership = (entry: DeckShare) => {
    dispatchAction(action('transferOwnership'), {
      ...idInput,
      userId: entry.userId,
    })
      .then(updated => {
        setConfirmingTransfer(null)
        onChange(updated)
        // Re-read the list: the new owner leaves it, the old owner joins
        return dispatchAction<DeckShare[]>(action('shares'), idInput).then(
          setShares,
        )
      })
      .catch(() => {
        // Quiet failure: ownership stays as saved
        setConfirmingTransfer(null)
      })
  }

  /** The per-person menu: role change, ownership transfer, revocation. */
  const onRowAction = (entry: DeckShare, value: string) => {
    if (value === 'remove') return remove(entry)
    if (value === 'transfer') return setConfirmingTransfer(entry)
    const nextRole = value as ShareRole
    if (nextRole === entry.role) return
    grant(entry.email, nextRole)
      .then(setShares)
      .catch(() => {
        // Quiet failure: the row keeps its saved role
      })
  }

  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold text-slate-700">Access</h3>

      {entity === 'deck' && (
        <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {subject.accessInherited ? (
            <>Inherited from the project — changes here detach this lecture.</>
          ) : (
            <>
              Overridden for this lecture.{' '}
              <button
                onClick={resetToProject}
                className="cursor-pointer text-indigo-600 hover:underline"
              >
                Use project settings
              </button>
            </>
          )}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">
            People with access
          </h4>
          <form
            onSubmit={e => void addPerson(e)}
            aria-label="Add people"
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="person@example.com"
              aria-label="Add people by email"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={e => setRole(e.target.value as ShareRole)}
              aria-label="Access role"
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {shareError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {shareError}
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {shares.map(entry => (
              <li
                key={entry.userId}
                className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="font-medium">{entry.displayName}</span>
                <span className="truncate text-slate-500">{entry.email}</span>
                <select
                  value={entry.role}
                  onChange={e => onRowAction(entry, e.target.value)}
                  aria-label={`Role for ${entry.displayName}`}
                  className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  {isOwner && (
                    <option value="transfer">Transfer ownership</option>
                  )}
                  <option value="remove">Remove access</option>
                </select>
              </li>
            ))}
            {shares.length === 0 && (
              <li className="text-sm text-slate-500">
                Only you have access so far.
              </li>
            )}
          </ul>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            General access
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            {GENERAL_ACCESS.map(option => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 has-checked:border-indigo-400 has-checked:bg-indigo-50 sm:flex-1"
              >
                <input
                  type="radio"
                  name="General access"
                  value={option.value}
                  checked={subject.visibility === option.value}
                  onChange={() => setGeneralAccess(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {confirmingTransfer && (
        <ConfirmDialog
          title="Transfer ownership?"
          message={`Make ${confirmingTransfer.displayName} the owner of "${subject.name}"? You will keep edit access.`}
          confirmLabel="Transfer"
          onConfirm={() => transferOwnership(confirmingTransfer)}
          onCancel={() => setConfirmingTransfer(null)}
        />
      )}
    </section>
  )
}
