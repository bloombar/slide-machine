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
import { useTranslation } from 'react-i18next'
import type { DeckShare, ShareRole, Visibility } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import ConfirmDialog from './ConfirmDialog'
import { apiErrorMessage } from '../i18n/apiError'

/** The general-access choices, in order. Each value keys its own label
 * and hint under `access.general.<value>` in the locale bundles. */
const GENERAL_ACCESS: readonly Visibility[] = ['public', 'restricted']

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
  const { t } = useTranslation()
  const [shares, setShares] = useState<DeckShare[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [shareError, setShareError] = useState<string | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)
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
    setAccessError(null)
    dispatchAction(action('setAccess'), { ...idInput, visibility })
      .then(onChange)
      .catch(err => {
        // The radios revert to the saved value on rerender, but a refusal
        // the user can act on must say so — an unconfirmed account is told
        // to confirm its address rather than left wondering (AUTH-3).
        setAccessError(apiErrorMessage(err, t, 'access.errors.setAccess'))
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
      setShareError(t('access.errors.noAccount'))
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
      <h3 className="mb-4 text-lg font-semibold text-slate-700">
        {t('access.heading')}
      </h3>

      {entity === 'deck' && (
        <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {subject.accessInherited ? (
            t('access.inherited')
          ) : (
            <>
              {t('access.overridden')}{' '}
              <button
                onClick={resetToProject}
                className="cursor-pointer text-indigo-600 hover:underline"
              >
                {t('access.useProject')}
              </button>
            </>
          )}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">
            {t('access.people')}
          </h4>
          <form
            onSubmit={e => void addPerson(e)}
            aria-label={t('access.addPeople')}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('access.emailPlaceholder')}
              aria-label={t('access.addByEmail')}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={e => setRole(e.target.value as ShareRole)}
              aria-label={t('access.role')}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="viewer">{t('access.roles.viewer')}</option>
              <option value="editor">{t('access.roles.editor')}</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {t('access.add')}
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
                  aria-label={t('access.roleFor', {
                    name: entry.displayName,
                  })}
                  className="ms-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="viewer">{t('access.roles.viewer')}</option>
                  <option value="editor">{t('access.roles.editor')}</option>
                  {isOwner && (
                    <option value="transfer">{t('access.transfer')}</option>
                  )}
                  <option value="remove">{t('access.remove')}</option>
                </select>
              </li>
            ))}
            {shares.length === 0 && (
              <li className="text-sm text-slate-500">{t('access.onlyYou')}</li>
            )}
          </ul>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            {t('access.general.heading')}
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            {GENERAL_ACCESS.map(option => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 has-checked:border-indigo-400 has-checked:bg-indigo-50 sm:flex-1"
              >
                <input
                  type="radio"
                  name="general-access"
                  value={option}
                  checked={subject.visibility === option}
                  onChange={() => setGeneralAccess(option)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {t(`access.general.${option}.label`)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t(`access.general.${option}.hint`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {accessError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {accessError}
            </p>
          )}
        </fieldset>
      </div>

      {confirmingTransfer && (
        <ConfirmDialog
          title={t('access.transferConfirm.title')}
          message={t('access.transferConfirm.message', {
            name: confirmingTransfer.displayName,
            subject: subject.name,
          })}
          confirmLabel={t('access.transferConfirm.action')}
          onConfirm={() => transferOwnership(confirmingTransfer)}
          onCancel={() => setConfirmingTransfer(null)}
        />
      )}
    </section>
  )
}
